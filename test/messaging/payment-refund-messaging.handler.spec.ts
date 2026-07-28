import { ConfigService } from "@nestjs/config";
import type { PaymentRefundService } from "../../src/payment/application/services/payment-refund.service";
import { Payment } from "../../src/payment/domain/entities/payment.entity";
import { PaymentStatus } from "../../src/payment/domain/enums/payment-status.enum";
import { MongoConsumedMessageRepository } from "../../src/messaging/consumed-message.repository";
import { PaymentRefundMessagingHandler } from "../../src/messaging/payment-refund-messaging.handler";

const refundService = {
  execute: jest.fn(),
} as unknown as jest.Mocked<PaymentRefundService>;
const consumer = { subscribe: jest.fn() };
const publisher = { publish: jest.fn() };
const ledger = {
  claim: jest.fn(),
  markProcessed: jest.fn(),
  markFailed: jest.fn(),
} as unknown as jest.Mocked<MongoConsumedMessageRepository>;

describe("PaymentRefundMessagingHandler", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    ledger.markFailed.mockResolvedValue();
    ledger.markProcessed.mockResolvedValue();
    publisher.publish.mockResolvedValue(undefined);
  });

  it("does not subscribe when messaging is disabled", async () => {
    await handler(false).onModuleInit();
    expect(consumer.subscribe).not.toHaveBeenCalled();
  });

  it("subscribes only to the existing compensation queue when enabled", async () => {
    await handler(true).onModuleInit();
    expect(consumer.subscribe).toHaveBeenCalledWith(
      "billing.payment.compensation.requests",
      expect.any(Function),
    );
  });

  it.each([
    { eventName: "payment.refunded" },
    { eventVersion: 2 },
    { eventId: " " },
    { occurredAt: "invalid" },
    { correlationId: "" },
    { causationId: "" },
    { sagaId: "" },
    { orderId: "" },
    { payload: { paymentId: "payment-1" } },
    { payload: { paymentId: "payment-1", reason: "x", amount: 10 } },
    { payload: { paymentId: "", reason: "x" } },
  ])("rejects an invalid request before the ledger: %o", async (override) => {
    await expect(
      handler(true).handle({ ...request(), ...override }),
    ).rejects.toThrow("Invalid payment.refund.requested");
    expect(ledger.claim).not.toHaveBeenCalled();
    expect(refundService.execute).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("publishes a persisted refund before marking the ledger processed", async () => {
    ledger.claim.mockResolvedValue({ token: "claim-1" });
    refundService.execute.mockResolvedValue({
      outcome: "REFUNDED",
      payment: refundedPayment(),
    });
    let confirmPublish!: () => void;
    publisher.publish.mockReturnValue(
      new Promise<void>((resolve) => {
        confirmPublish = resolve;
      }),
    );

    const processing = handler(true).handle(request());
    await Promise.resolve();
    await Promise.resolve();
    expect(ledger.markProcessed).not.toHaveBeenCalled();

    confirmPublish();
    await processing;
    expect(publisher.publish).toHaveBeenCalledWith(
      "billing.topic",
      "payment.refunded",
      {
        eventId: expect.any(String),
        eventName: "payment.refunded",
        eventVersion: 1,
        occurredAt: "2026-07-25T12:00:00.000Z",
        correlationId: "correlation-1",
        causationId: "event-1",
        sagaId: "saga-1",
        orderId: "order-1",
        payload: {
          paymentId: "payment-1",
          budgetId: "budget-1",
          status: "REFUNDED",
          providerPaymentId: "provider-payment-1",
          providerRefundId: "provider-refund-1",
        },
      },
    );
    expect(ledger.markProcessed).toHaveBeenCalledWith(
      "billing-payment-refund-requested",
      "event-1",
      "claim-1",
    );
  });

  it("publishes only a persisted confirmed business rejection", async () => {
    ledger.claim.mockResolvedValue({ token: "claim-1" });
    refundService.execute.mockResolvedValue({
      outcome: "REJECTED",
      payment: rejectedPayment("PAYMENT_NOT_APPROVED"),
    });

    await handler(true).handle(request());

    expect(publisher.publish).toHaveBeenCalledWith(
      "billing.topic",
      "payment.refund.failed",
      {
        eventId: expect.any(String),
        eventName: "payment.refund.failed",
        eventVersion: 1,
        occurredAt: "2026-07-25T11:00:00.000Z",
        correlationId: "correlation-1",
        causationId: "event-1",
        sagaId: "saga-1",
        orderId: "order-1",
        payload: {
          paymentId: "payment-1",
          budgetId: "budget-1",
          status: "REFUND_FAILED",
          providerPaymentId: "provider-payment-1",
          failureCode: "PAYMENT_NOT_APPROVED",
        },
      },
    );
  });

  it("returns a processed duplicate without mutation or publication", async () => {
    ledger.claim.mockResolvedValue(null);
    await handler(true).handle(request());
    expect(refundService.execute).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(ledger.markProcessed).not.toHaveBeenCalled();
  });

  it("propagates a concurrent ledger claim without executing refund", async () => {
    ledger.claim.mockRejectedValue(new Error("already processing"));
    await expect(handler(true).handle(request())).rejects.toThrow(
      "already processing",
    );
    expect(refundService.execute).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it.each([
    "provider timeout",
    "mongo unavailable",
    "payment identity mismatch",
    "refund context conflict",
  ])("marks technical failure without publishing: %s", async (message) => {
    ledger.claim.mockResolvedValue({ token: "claim-1" });
    refundService.execute.mockRejectedValue(new Error(message));

    await expect(handler(true).handle(request())).rejects.toThrow(message);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(ledger.markFailed).toHaveBeenCalledWith(
      "billing-payment-refund-requested",
      "event-1",
      "claim-1",
    );
  });

  it("keeps the claim recoverable when publisher confirm fails", async () => {
    ledger.claim.mockResolvedValue({ token: "claim-1" });
    refundService.execute.mockResolvedValue({
      outcome: "REFUNDED",
      payment: refundedPayment(),
    });
    publisher.publish.mockRejectedValue(new Error("negative confirm"));

    await expect(handler(true).handle(request())).rejects.toThrow(
      "negative confirm",
    );
    expect(ledger.markProcessed).not.toHaveBeenCalled();
    expect(ledger.markFailed).toHaveBeenCalledWith(
      "billing-payment-refund-requested",
      "event-1",
      "claim-1",
    );
  });

  it("rethrows markProcessed failure and cannot complete with a stale token", async () => {
    ledger.claim.mockResolvedValue({ token: "stale-token" });
    refundService.execute.mockResolvedValue({
      outcome: "REFUNDED",
      payment: refundedPayment(),
    });
    ledger.markProcessed.mockRejectedValue(new Error("claim lost"));
    ledger.markFailed.mockRejectedValue(new Error("stale token"));

    await expect(handler(true).handle(request())).rejects.toThrow("claim lost");
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("re-publishes byte-equivalent outcomes after restart or failed completion", async () => {
    ledger.claim
      .mockResolvedValueOnce({ token: "claim-1" })
      .mockResolvedValueOnce({ token: "claim-2" });
    refundService.execute.mockResolvedValue({
      outcome: "REFUNDED",
      payment: refundedPayment(),
    });
    ledger.markProcessed.mockRejectedValueOnce(new Error("process stopped"));

    await expect(handler(true).handle(request())).rejects.toThrow(
      "process stopped",
    );
    await handler(true).handle(request());
    expect(publisher.publish.mock.calls[0]).toEqual(
      publisher.publish.mock.calls[1],
    );
  });

  it("re-publishes an identical persisted rejection without secrets in logs", async () => {
    const output = jest.spyOn(process.stdout, "write");
    ledger.claim
      .mockResolvedValueOnce({ token: "claim-1" })
      .mockResolvedValueOnce({ token: "claim-2" });
    refundService.execute.mockResolvedValue({
      outcome: "REJECTED",
      payment: rejectedPayment("PROVIDER_PAYMENT_MISSING"),
    });
    ledger.markProcessed.mockRejectedValueOnce(new Error("process stopped"));

    await expect(handler(true).handle(request())).rejects.toThrow();
    await handler(true).handle(request());
    expect(publisher.publish.mock.calls[0]).toEqual(
      publisher.publish.mock.calls[1],
    );
    expect(output).not.toHaveBeenCalled();
    output.mockRestore();
  });
});

function handler(enabled: boolean): PaymentRefundMessagingHandler {
  return new PaymentRefundMessagingHandler(
    refundService,
    consumer,
    publisher,
    ledger,
    new ConfigService({ MESSAGING_ENABLED: enabled }),
  );
}

function request() {
  return {
    eventId: "event-1",
    eventName: "payment.refund.requested",
    eventVersion: 1,
    occurredAt: "2026-07-25T10:00:00.000Z",
    correlationId: "correlation-1",
    causationId: "cause-1",
    sagaId: "saga-1",
    orderId: "order-1",
    payload: {
      paymentId: "payment-1",
      reason: "order cancellation",
    },
  };
}

function refundedPayment(): Payment {
  return Payment.restore({
    ...basePayment(),
    status: PaymentStatus.REFUNDED,
    providerPaymentId: "provider-payment-1",
    providerRefundId: "provider-refund-1",
    providerStatus: "refunded",
    refundCommandEventId: "event-1",
    refundCorrelationId: "correlation-1",
    refundIdempotencyKey: "stable-key",
    refundReason: "order cancellation",
    refundRequestedAt: new Date("2026-07-25T10:30:00.000Z"),
    refundedAt: new Date("2026-07-25T12:00:00.000Z"),
    updatedAt: new Date("2026-07-25T12:00:00.000Z"),
  });
}

function rejectedPayment(failureCode: string): Payment {
  return Payment.restore({
    ...basePayment(),
    status: PaymentStatus.PENDING,
    providerPaymentId: "provider-payment-1",
    refundCommandEventId: "event-1",
    refundCorrelationId: "correlation-1",
    refundIdempotencyKey: "stable-key",
    refundReason: "order cancellation",
    refundRequestedAt: new Date("2026-07-25T10:30:00.000Z"),
    refundFailureCode: failureCode,
    refundFailedAt: new Date("2026-07-25T11:00:00.000Z"),
    updatedAt: new Date("2026-07-25T11:00:00.000Z"),
  });
}

function basePayment() {
  return {
    id: "payment-1",
    budgetId: "budget-1",
    orderId: "order-1",
    sagaId: "saga-1",
    externalReference: "payment-1",
    amount: 100,
    currency: "BRL" as const,
    createdAt: new Date("2026-07-25T09:00:00.000Z"),
    updatedAt: new Date("2026-07-25T09:00:00.000Z"),
  };
}
