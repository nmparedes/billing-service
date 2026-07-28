import { DomainException } from "../../src/common/exceptions/domain.exception";
import {
  PaymentRefundService,
  createRefundIdempotencyKey,
} from "../../src/payment/application/services/payment-refund.service";
import { Payment } from "../../src/payment/domain/entities/payment.entity";
import { PaymentStatus } from "../../src/payment/domain/enums/payment-status.enum";
import type { PaymentProvider } from "../../src/payment/domain/providers/payment-provider.interface";
import type { PaymentRepository } from "../../src/payment/domain/repositories/payment.repository.interface";

describe("PaymentRefundService", () => {
  let repository: jest.Mocked<PaymentRepository>;
  let provider: jest.Mocked<PaymentProvider>;
  let service: PaymentRefundService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      findByBudgetId: jest.fn(),
      findByExternalReference: jest.fn(),
      createIfAbsent: jest.fn(),
      tryClaimPreferenceCreation: jest.fn(),
      releasePreferenceCreation: jest.fn(),
      save: jest.fn(),
      claimRefund: jest.fn(),
      completeRefund: jest.fn(),
      releaseRefundClaim: jest.fn().mockResolvedValue(true),
      rejectRefund: jest.fn(),
      rejectRefundRequest: jest.fn(),
    };
    provider = {
      createPreference: jest.fn(),
      getPayment: jest.fn(),
      refundPayment: jest.fn(),
    };
    service = new PaymentRefundService(repository, provider);
  });

  it("claims and completes an approved refund with a stable provider key", async () => {
    const payment = approvedPayment();
    const claimed = withRefundContext(payment);
    const refunded = refundedPayment();
    repository.findById.mockResolvedValue(payment);
    repository.claimRefund.mockResolvedValue({
      outcome: "CLAIMED",
      payment: claimed,
      claimToken: "claim-1",
    });
    provider.refundPayment.mockResolvedValue({
      providerRefundId: "provider-refund-1",
      status: "COMPLETED",
    });
    repository.completeRefund.mockResolvedValue(refunded);

    await expect(service.execute(input())).resolves.toEqual({
      outcome: "REFUNDED",
      payment: refunded,
    });
    expect(provider.refundPayment).toHaveBeenCalledWith({
      providerPaymentId: "provider-payment-1",
      idempotencyKey: createRefundIdempotencyKey("payment-1"),
    });
    expect(repository.completeRefund).toHaveBeenCalledWith(
      "payment-1",
      "claim-1",
      "provider-refund-1",
      expect.any(Date),
    );
  });

  it("returns a persisted refund without calling the provider", async () => {
    const payment = refundedPayment();
    repository.findById.mockResolvedValue(payment);
    repository.claimRefund.mockResolvedValue({
      outcome: "REFUNDED",
      payment,
    });

    await expect(service.execute(input())).resolves.toEqual({
      outcome: "REFUNDED",
      payment,
    });
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it("rejects missing and incompatible payments as invalid messages", async () => {
    repository.findById.mockResolvedValueOnce(null);
    await expect(service.execute(input())).rejects.toMatchObject({
      code: "PAYMENT_NOT_FOUND",
    });

    repository.findById.mockResolvedValueOnce(approvedPayment());
    await expect(
      service.execute({ ...input(), orderId: "other-order" }),
    ).rejects.toMatchObject({ code: "PAYMENT_REFUND_IDENTITY_MISMATCH" });
  });

  it("persists confirmed business rejections without calling the provider", async () => {
    const notApproved = rejectedPayment(
      pendingPayment(),
      "PAYMENT_NOT_APPROVED",
    );
    repository.findById.mockResolvedValueOnce(pendingPayment());
    repository.rejectRefundRequest.mockResolvedValueOnce(notApproved);

    await expect(service.execute(input())).resolves.toEqual({
      outcome: "REJECTED",
      payment: notApproved,
    });
    expect(repository.rejectRefundRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "payment-1",
        commandEventId: "command-1",
        idempotencyKey: createRefundIdempotencyKey("payment-1"),
      }),
      "PAYMENT_NOT_APPROVED",
      expect.any(Date),
    );

    const missingProvider = approvedPaymentWithoutProvider();
    const persistedMissingProvider = rejectedPayment(
      missingProvider,
      "PROVIDER_PAYMENT_MISSING",
    );
    repository.findById.mockResolvedValueOnce(missingProvider);
    repository.rejectRefundRequest.mockResolvedValueOnce(
      persistedMissingProvider,
    );
    await expect(service.execute(input())).resolves.toEqual({
      outcome: "REJECTED",
      payment: persistedMissingProvider,
    });
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it("rejects a concurrent claim without calling the provider", async () => {
    const payment = approvedPayment();
    repository.findById.mockResolvedValue(payment);
    repository.claimRefund.mockResolvedValue({ outcome: "BUSY", payment });

    await expect(service.execute(input())).rejects.toMatchObject({
      code: "PAYMENT_REFUND_IN_PROGRESS",
    });
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it("releases the current claim after a technical provider error", async () => {
    const payment = approvedPayment();
    repository.findById.mockResolvedValue(payment);
    repository.claimRefund.mockResolvedValue({
      outcome: "CLAIMED",
      payment: withRefundContext(payment),
      claimToken: "claim-1",
    });
    provider.refundPayment.mockRejectedValue(new Error("provider unavailable"));

    await expect(service.execute(input())).rejects.toThrow(
      "provider unavailable",
    );
    expect(repository.releaseRefundClaim).toHaveBeenCalledWith(
      "payment-1",
      "claim-1",
    );
  });

  it("does not hide an unsupported provider result", async () => {
    const payment = approvedPayment();
    repository.findById.mockResolvedValue(payment);
    repository.claimRefund.mockResolvedValue({
      outcome: "CLAIMED",
      payment: withRefundContext(payment),
      claimToken: "claim-1",
    });
    provider.refundPayment.mockResolvedValue({
      providerRefundId: "provider-refund-1",
      status: "UNKNOWN" as "COMPLETED",
    });

    await expect(service.execute(input())).rejects.toThrow("incomplete refund");
    expect(repository.releaseRefundClaim).toHaveBeenCalled();
  });

  it("reuses the same provider key after completion persistence fails", async () => {
    const payment = approvedPayment();
    const firstClaim = withRefundContext(payment);
    const secondClaim = Payment.restore({
      id: firstClaim.id,
      budgetId: firstClaim.budgetId,
      orderId: firstClaim.orderId,
      sagaId: firstClaim.sagaId,
      externalReference: firstClaim.externalReference,
      amount: firstClaim.amount,
      currency: firstClaim.currency,
      status: firstClaim.status,
      providerPaymentId: firstClaim.providerPaymentId,
      providerStatus: firstClaim.providerStatus,
      refundCommandEventId: firstClaim.refundCommandEventId,
      refundCorrelationId: firstClaim.refundCorrelationId,
      refundIdempotencyKey: firstClaim.refundIdempotencyKey,
      refundReason: firstClaim.refundReason,
      refundRequestedAt: firstClaim.refundRequestedAt,
      createdAt: firstClaim.createdAt,
      approvedAt: firstClaim.approvedAt,
      updatedAt: firstClaim.updatedAt,
    });
    repository.findById.mockResolvedValue(payment);
    repository.claimRefund
      .mockResolvedValueOnce({
        outcome: "CLAIMED",
        payment: firstClaim,
        claimToken: "claim-1",
      })
      .mockResolvedValueOnce({
        outcome: "CLAIMED",
        payment: secondClaim,
        claimToken: "claim-2",
      });
    provider.refundPayment.mockResolvedValue({
      providerRefundId: "provider-refund-1",
      status: "COMPLETED",
    });
    repository.completeRefund
      .mockRejectedValueOnce(new Error("mongo write failed"))
      .mockResolvedValueOnce(refundedPayment());

    await expect(service.execute(input())).rejects.toThrow(
      "mongo write failed",
    );
    await expect(service.execute(input())).resolves.toMatchObject({
      outcome: "REFUNDED",
      payment: { providerRefundId: "provider-refund-1" },
    });
    expect(provider.refundPayment).toHaveBeenNthCalledWith(1, {
      providerPaymentId: "provider-payment-1",
      idempotencyKey: createRefundIdempotencyKey("payment-1"),
    });
    expect(provider.refundPayment).toHaveBeenNthCalledWith(2, {
      providerPaymentId: "provider-payment-1",
      idempotencyKey: createRefundIdempotencyKey("payment-1"),
    });
  });

  it("validates and sanitizes command input before persistence", async () => {
    await expect(
      service.execute({ ...input(), commandEventId: " " }),
    ).rejects.toBeInstanceOf(DomainException);
    expect(repository.findById).not.toHaveBeenCalled();
  });
});

function input() {
  return {
    paymentId: "payment-1",
    orderId: "order-1",
    sagaId: "saga-1",
    commandEventId: "command-1",
    correlationId: "correlation-1",
    reason: "order cancellation",
  };
}

function pendingPayment(): Payment {
  const payment = Payment.create({
    id: "payment-1",
    budgetId: "budget-1",
    orderId: "order-1",
    sagaId: "saga-1",
    amount: 100,
    createdAt: new Date("2026-07-25T10:00:00.000Z"),
  });
  payment.updateProviderPayment("provider-payment-1", "approved");
  return payment;
}

function approvedPayment(): Payment {
  const payment = pendingPayment();
  payment.applyProviderStatus(PaymentStatus.APPROVED);
  return payment;
}

function approvedPaymentWithoutProvider(): Payment {
  const payment = Payment.create({
    id: "payment-1",
    budgetId: "budget-1",
    orderId: "order-1",
    sagaId: "saga-1",
    amount: 100,
  });
  payment.applyProviderStatus(PaymentStatus.APPROVED);
  return payment;
}

function withRefundContext(payment: Payment): Payment {
  payment.prepareRefund({
    commandEventId: "command-1",
    correlationId: "correlation-1",
    idempotencyKey: createRefundIdempotencyKey(payment.id),
    reason: "order cancellation",
    requestedAt: new Date("2026-07-25T11:00:00.000Z"),
  });
  return payment;
}

function refundedPayment(): Payment {
  const payment = withRefundContext(approvedPayment());
  payment.markRefunded(
    "provider-refund-1",
    new Date("2026-07-25T11:01:00.000Z"),
  );
  return payment;
}

function rejectedPayment(payment: Payment, failureCode: string): Payment {
  return Payment.restore({
    id: payment.id,
    budgetId: payment.budgetId,
    orderId: payment.orderId,
    sagaId: payment.sagaId,
    externalReference: payment.externalReference,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    providerPaymentId: payment.providerPaymentId,
    providerStatus: payment.providerStatus,
    createdAt: payment.createdAt,
    approvedAt: payment.approvedAt,
    refundCommandEventId: "command-1",
    refundCorrelationId: "correlation-1",
    refundIdempotencyKey: createRefundIdempotencyKey(payment.id),
    refundReason: "order cancellation",
    refundRequestedAt: new Date("2026-07-25T11:00:00.000Z"),
    refundFailureCode: failureCode,
    refundFailedAt: new Date("2026-07-25T11:01:00.000Z"),
    updatedAt: new Date("2026-07-25T11:01:00.000Z"),
  });
}
