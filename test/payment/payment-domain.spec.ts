import { DomainException } from "../../src/common/exceptions/domain.exception";
import { Payment } from "../../src/payment/domain/entities/payment.entity";
import { PaymentStatus } from "../../src/payment/domain/enums/payment-status.enum";

describe("Payment", () => {
  it("creates a BRL pending payment with its local ID as external reference", () => {
    const payment = Payment.create({
      id: "payment-1",
      budgetId: "budget-1",
      orderId: "order-1",
      sagaId: "saga-1",
      amount: 400,
      createdAt: new Date("2026-07-24T12:00:00.000Z"),
    });

    expect(payment.externalReference).toBe(payment.id);
    expect(payment.currency).toBe("BRL");
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  it("assigns a single provider preference", () => {
    const payment = createPayment();

    payment.assignPreference(
      "preference-1",
      "https://checkout.test/preference-1",
    );
    payment.assignPreference(
      "preference-1",
      "https://checkout.test/preference-1",
    );

    expect(payment.providerPreferenceId).toBe("preference-1");
    expect(payment.checkoutUrl).toBe("https://checkout.test/preference-1");
    expect(() =>
      payment.assignPreference(
        "preference-2",
        "https://checkout.test/preference-2",
      ),
    ).toThrow(DomainException);
  });

  it("rejects an invalid amount or provider response", () => {
    expect(() =>
      Payment.create({
        budgetId: "budget-1",
        orderId: "order-1",
        sagaId: "saga-1",
        amount: 0,
      }),
    ).toThrow(DomainException);
    expect(() => createPayment().assignPreference("", "")).toThrow(
      DomainException,
    );
    expect(() => createPayment().updateProviderPayment("", "approved")).toThrow(
      DomainException,
    );
  });

  it("stores a provider payment ID when it becomes available", () => {
    const payment = createPayment();

    payment.updateProviderPayment("provider-payment-1", "approved");

    expect(payment.providerPaymentId).toBe("provider-payment-1");
    expect(payment.providerStatus).toBe("approved");
    expect(
      payment.updateProviderPayment("provider-payment-1", "approved"),
    ).toBe(false);
    expect(() =>
      payment.updateProviderPayment("provider-payment-2", "approved"),
    ).toThrow(DomainException);
  });

  it("applies only valid and idempotent provider status transitions", () => {
    const payment = createPayment();

    expect(payment.applyProviderStatus(PaymentStatus.PENDING)).toBe(false);
    expect(payment.applyProviderStatus(PaymentStatus.APPROVED)).toBe(true);
    expect(payment.applyProviderStatus(PaymentStatus.APPROVED)).toBe(false);
    expect(() => payment.applyProviderStatus(PaymentStatus.PENDING)).toThrow(
      DomainException,
    );
    expect(payment.applyProviderStatus(PaymentStatus.REFUNDED)).toBe(true);
  });

  it("persists the timestamp of approved and failed business transitions", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-24T13:00:00.000Z"));
    const approved = createPayment();
    approved.applyProviderStatus(PaymentStatus.APPROVED);

    jest.setSystemTime(new Date("2026-07-24T14:00:00.000Z"));
    const failed = createPayment();
    failed.applyProviderStatus(PaymentStatus.FAILED);

    expect(approved.approvedAt?.toISOString()).toBe("2026-07-24T13:00:00.000Z");
    expect(failed.failedAt?.toISOString()).toBe("2026-07-24T14:00:00.000Z");
    jest.useRealTimers();
  });

  it("keeps an immutable refund context and defensive date copies", () => {
    const requestedAt = new Date("2026-07-25T10:00:00.000Z");
    const payment = approvedPayment();

    expect(
      payment.prepareRefund({
        commandEventId: "command-1",
        correlationId: "correlation-1",
        idempotencyKey: "key-1",
        reason: "order cancellation",
        requestedAt,
      }),
    ).toBe(true);
    expect(
      payment.prepareRefund({
        commandEventId: "command-1",
        correlationId: "correlation-1",
        idempotencyKey: "key-1",
        reason: "order cancellation",
        requestedAt: new Date("2026-07-25T11:00:00.000Z"),
      }),
    ).toBe(false);

    requestedAt.setUTCFullYear(2030);
    const exposed = payment.refundRequestedAt!;
    exposed.setUTCFullYear(2031);
    expect(payment.refundRequestedAt?.toISOString()).toBe(
      "2026-07-25T10:00:00.000Z",
    );
    expect(() =>
      payment.prepareRefund({
        commandEventId: "command-2",
        correlationId: "correlation-1",
        idempotencyKey: "key-1",
        reason: "order cancellation",
        requestedAt: new Date(),
      }),
    ).toThrow(
      expect.objectContaining({ code: "PAYMENT_REFUND_CONTEXT_CONFLICT" }),
    );
  });

  it("completes a refund once and rejects provider refund replacement", () => {
    const payment = approvedPayment();
    payment.prepareRefund({
      commandEventId: "command-1",
      correlationId: "correlation-1",
      idempotencyKey: "key-1",
      reason: "order cancellation",
      requestedAt: new Date("2026-07-25T10:00:00.000Z"),
    });

    expect(
      payment.markRefunded(
        "provider-refund-1",
        new Date("2026-07-25T10:01:00.000Z"),
      ),
    ).toBe(true);
    expect(
      payment.markRefunded(
        "provider-refund-1",
        new Date("2026-07-25T10:02:00.000Z"),
      ),
    ).toBe(false);
    expect(() => payment.markRefunded("provider-refund-2", new Date())).toThrow(
      expect.objectContaining({ code: "PAYMENT_REFUND_ALREADY_ASSIGNED" }),
    );
  });

  it("rejects refund preparation for a payment that is not approved", () => {
    expect(() =>
      createPayment().prepareRefund({
        commandEventId: "command-1",
        correlationId: "correlation-1",
        idempotencyKey: "key-1",
        reason: "order cancellation",
        requestedAt: new Date(),
      }),
    ).toThrow(expect.objectContaining({ code: "PAYMENT_REFUND_NOT_ALLOWED" }));
  });

  it("records a sanitized business rejection without completing the refund", () => {
    const payment = approvedPayment();
    payment.prepareRefund({
      commandEventId: "command-1",
      correlationId: "correlation-1",
      idempotencyKey: "key-1",
      reason: "order cancellation",
      requestedAt: new Date("2026-07-25T10:00:00.000Z"),
    });

    expect(
      payment.markRefundRejected(
        "PAYMENT_NOT_REFUNDABLE",
        new Date("2026-07-25T10:01:00.000Z"),
      ),
    ).toBe(true);
    expect(payment.status).toBe(PaymentStatus.APPROVED);
    expect(payment.refundFailureCode).toBe("PAYMENT_NOT_REFUNDABLE");
    expect(payment.refundFailedAt?.toISOString()).toBe(
      "2026-07-25T10:01:00.000Z",
    );
  });
});

function createPayment(): Payment {
  return Payment.create({
    id: "payment-1",
    budgetId: "budget-1",
    orderId: "order-1",
    sagaId: "saga-1",
    amount: 400,
  });
}

function approvedPayment(): Payment {
  const payment = createPayment();
  payment.updateProviderPayment("provider-payment-1", "approved");
  payment.applyProviderStatus(PaymentStatus.APPROVED);
  return payment;
}
