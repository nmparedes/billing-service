import { ConfigService } from "@nestjs/config";
import { MongoClient } from "mongodb";
import {
  PaymentRefundService,
  createRefundIdempotencyKey,
} from "../../src/payment/application/services/payment-refund.service";
import { Payment } from "../../src/payment/domain/entities/payment.entity";
import { PaymentStatus } from "../../src/payment/domain/enums/payment-status.enum";
import type { PaymentProvider } from "../../src/payment/domain/providers/payment-provider.interface";
import { MongoPaymentRepository } from "../../src/payment/infrastructure/repositories/mongo-payment.repository";
import { MongoConsumedMessageRepository } from "../../src/messaging/consumed-message.repository";
import { PaymentRefundMessagingHandler } from "../../src/messaging/payment-refund-messaging.handler";

const describeMongo =
  process.env.RUN_MONGODB_INTEGRATION === "true" ? describe : describe.skip;

describeMongo("Payment refund MongoDB integration", () => {
  let client: MongoClient;
  let repository: MongoPaymentRepository;

  beforeAll(async () => {
    client = new MongoClient(
      process.env.MONGODB_URI ??
        "mongodb://127.0.0.1:27017/billing_refund_integration",
    );
    await client.connect();
    repository = new MongoPaymentRepository(
      client,
      new ConfigService({ PAYMENT_REFUND_LEASE_MS: 60000 }),
    );
  });

  beforeEach(async () => {
    await client.db().collection("payments").deleteMany({});
    await client.db().collection("consumed_messages").deleteMany({});
  });

  afterAll(async () => {
    await client.db().dropDatabase();
    await client.close();
  });

  it("allows one concurrent worker and recovers an expired lease atomically", async () => {
    await persistApprovedPayment();

    const [first, second] = await Promise.all([
      repository.claimRefund(claimInput()),
      repository.claimRefund(claimInput()),
    ]);
    const claimed = [first, second].find(
      (result) => result.outcome === "CLAIMED",
    );
    expect([first.outcome, second.outcome].sort()).toEqual(["BUSY", "CLAIMED"]);
    expect(claimed?.outcome).toBe("CLAIMED");

    const firstRequestedAt = claimed!.payment.refundRequestedAt;
    const claimedDocument = await client
      .db()
      .collection<{ _id: string }>("payments")
      .findOne({ _id: "payment-1" });
    expect(claimedDocument).toMatchObject({
      refundCommandEventId: "command-1",
      refundCorrelationId: "correlation-1",
      refundIdempotencyKey: createRefundIdempotencyKey("payment-1"),
      refundReason: "order cancellation",
      refundRequestedAt: expect.any(Date),
      refundProcessingToken: expect.any(String),
      refundProcessingStartedAt: expect.any(Date),
      refundLeaseExpiresAt: expect.any(Date),
    });
    await client
      .db()
      .collection<{ _id: string }>("payments")
      .updateOne(
        { _id: "payment-1" },
        { $set: { refundLeaseExpiresAt: new Date(Date.now() - 1) } },
      );
    const recovered = await repository.claimRefund(claimInput());
    expect(recovered.outcome).toBe("CLAIMED");
    expect(recovered.payment.refundRequestedAt).toEqual(firstRequestedAt);

    if (claimed?.outcome !== "CLAIMED" || recovered.outcome !== "CLAIMED") {
      throw new Error("Expected both original and recovered claims.");
    }
    await expect(
      repository.completeRefund(
        "payment-1",
        claimed.claimToken,
        "stale-refund",
        new Date(),
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_REFUND_CLAIM_LOST" });

    const completed = await repository.completeRefund(
      "payment-1",
      recovered.claimToken,
      "provider-refund-1",
      new Date("2026-07-25T15:00:00.000Z"),
    );
    expect(completed).toMatchObject({
      status: PaymentStatus.REFUNDED,
      providerRefundId: "provider-refund-1",
      refundCommandEventId: "command-1",
      refundCorrelationId: "correlation-1",
      refundIdempotencyKey: createRefundIdempotencyKey("payment-1"),
      refundReason: "order cancellation",
    });
    expect(completed.refundedAt?.toISOString()).toBe(
      "2026-07-25T15:00:00.000Z",
    );
  });

  it("keeps context immutable across a technical failure and retry", async () => {
    await persistApprovedPayment();
    const observedKeys: string[] = [];
    const provider: jest.Mocked<PaymentProvider> = {
      createPreference: jest.fn(),
      getPayment: jest.fn(),
      refundPayment: jest
        .fn()
        .mockImplementationOnce(async ({ idempotencyKey }) => {
          observedKeys.push(idempotencyKey);
          throw new Error("ambiguous timeout");
        })
        .mockImplementationOnce(async ({ idempotencyKey }) => {
          observedKeys.push(idempotencyKey);
          return {
            providerRefundId: "provider-refund-1",
            status: "COMPLETED",
          };
        }),
    };
    const service = new PaymentRefundService(repository, provider);

    await expect(service.execute(serviceInput())).rejects.toThrow(
      "ambiguous timeout",
    );
    const afterFailure = await repository.findById("payment-1");
    expect(afterFailure?.refundProcessingToken).toBeUndefined();
    const requestedAt = afterFailure?.refundRequestedAt;

    await expect(service.execute(serviceInput())).resolves.toMatchObject({
      outcome: "REFUNDED",
      payment: {
        status: PaymentStatus.REFUNDED,
        providerRefundId: "provider-refund-1",
      },
    });
    const restored = await repository.findById("payment-1");
    expect(observedKeys).toEqual([
      createRefundIdempotencyKey("payment-1"),
      createRefundIdempotencyKey("payment-1"),
    ]);
    expect(restored?.refundRequestedAt).toEqual(requestedAt);
    expect(restored?.refundProcessingToken).toBeUndefined();
  });

  it("rejects a different command and never replaces providerRefundId", async () => {
    await persistApprovedPayment();
    const claim = await repository.claimRefund(claimInput());
    expect(claim.outcome).toBe("CLAIMED");
    if (claim.outcome !== "CLAIMED") throw new Error("Expected claim.");

    await expect(
      repository.claimRefund({
        ...claimInput(),
        commandEventId: "different-command",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_REFUND_CONTEXT_CONFLICT" });
    await repository.completeRefund(
      "payment-1",
      claim.claimToken,
      "provider-refund-1",
      new Date(),
    );
    const replay = await repository.claimRefund(claimInput());
    expect(replay).toMatchObject({
      outcome: "REFUNDED",
      payment: { providerRefundId: "provider-refund-1" },
    });
  });

  it("persists a sanitized rejection and releases the current claim", async () => {
    await persistApprovedPayment();
    const claim = await repository.claimRefund(claimInput());
    if (claim.outcome !== "CLAIMED") throw new Error("Expected claim.");

    const failedAt = new Date("2026-07-25T16:00:00.000Z");
    const rejected = await repository.rejectRefund(
      "payment-1",
      claim.claimToken,
      "PAYMENT_NOT_REFUNDABLE",
      failedAt,
    );
    expect(rejected).toMatchObject({
      status: PaymentStatus.APPROVED,
      refundFailureCode: "PAYMENT_NOT_REFUNDABLE",
      refundFailedAt: failedAt,
    });
    expect(rejected.refundProcessingToken).toBeUndefined();
  });

  it("persists and replays the same business rejection atomically", async () => {
    await persistPendingPayment();
    const provider = providerFake();
    const service = new PaymentRefundService(repository, provider);

    const first = await service.execute(serviceInput());
    const second = await service.execute(serviceInput());

    expect(first).toMatchObject({
      outcome: "REJECTED",
      payment: {
        refundFailureCode: "PAYMENT_NOT_APPROVED",
        refundCommandEventId: "command-1",
      },
    });
    expect(second).toEqual(first);
    expect(provider.refundPayment).not.toHaveBeenCalled();
    await expect(
      service.execute({ ...serviceInput(), commandEventId: "command-2" }),
    ).rejects.toMatchObject({ code: "PAYMENT_REFUND_CONTEXT_CONFLICT" });
  });

  it("recovers persisted success and rejection after publish failure", async () => {
    const provider = providerFake();
    const publisher = { publish: jest.fn() };
    const ledger = new MongoConsumedMessageRepository(
      client,
      new ConfigService({ CONSUMED_MESSAGE_LEASE_MS: 60000 }),
    );
    const service = new PaymentRefundService(repository, provider);
    const handler = new PaymentRefundMessagingHandler(
      service,
      { subscribe: jest.fn() },
      publisher,
      ledger,
      new ConfigService({ MESSAGING_ENABLED: true }),
    );

    await persistApprovedPayment();
    provider.refundPayment.mockResolvedValue({
      providerRefundId: "provider-refund-1",
      status: "COMPLETED",
    });
    publisher.publish
      .mockRejectedValueOnce(new Error("broker unavailable"))
      .mockResolvedValue(undefined);
    await expect(handler.handle(request("event-success"))).rejects.toThrow(
      "broker unavailable",
    );
    await handler.handle(request("event-success"));
    expect(provider.refundPayment).toHaveBeenCalledTimes(1);
    expect(publisher.publish.mock.calls[0]).toEqual(
      publisher.publish.mock.calls[1],
    );

    await client.db().collection("payments").deleteMany({});
    await persistPendingPayment();
    publisher.publish.mockClear();
    publisher.publish
      .mockRejectedValueOnce(new Error("broker unavailable"))
      .mockResolvedValue(undefined);
    await expect(handler.handle(request("event-rejected"))).rejects.toThrow(
      "broker unavailable",
    );
    await handler.handle(request("event-rejected"));
    expect(provider.refundPayment).toHaveBeenCalledTimes(1);
    expect(publisher.publish.mock.calls[0]).toEqual(
      publisher.publish.mock.calls[1],
    );
    expect(publisher.publish.mock.calls[1][2]).toMatchObject({
      eventName: "payment.refund.failed",
      payload: { failureCode: "PAYMENT_NOT_APPROVED" },
    });
  });

  it("prevents an old consumed-message worker from completing a recovered lease", async () => {
    const ledger = new MongoConsumedMessageRepository(
      client,
      new ConfigService({ CONSUMED_MESSAGE_LEASE_MS: 60000 }),
    );
    const oldClaim = await ledger.claim("refund-consumer", "event-lease");
    expect(oldClaim).not.toBeNull();
    await client
      .db()
      .collection("consumed_messages")
      .updateOne(
        { consumerName: "refund-consumer", eventId: "event-lease" },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1) } },
      );
    const recovered = await ledger.claim("refund-consumer", "event-lease");
    expect(recovered).not.toBeNull();

    await expect(
      ledger.markProcessed("refund-consumer", "event-lease", oldClaim!.token),
    ).rejects.toThrow("claim was lost");
    await expect(
      ledger.markProcessed("refund-consumer", "event-lease", recovered!.token),
    ).resolves.toBeUndefined();
  });

  async function persistApprovedPayment(): Promise<void> {
    const payment = Payment.create({
      id: "payment-1",
      budgetId: "budget-1",
      orderId: "order-1",
      sagaId: "saga-1",
      amount: 100,
      createdAt: new Date("2026-07-25T10:00:00.000Z"),
    });
    payment.updateProviderPayment("provider-payment-1", "approved");
    payment.applyProviderStatus(PaymentStatus.APPROVED);
    await repository.createIfAbsent(payment);
  }

  async function persistPendingPayment(): Promise<void> {
    await repository.createIfAbsent(
      Payment.create({
        id: "payment-1",
        budgetId: "budget-1",
        orderId: "order-1",
        sagaId: "saga-1",
        amount: 100,
      }),
    );
  }
});

function claimInput() {
  return {
    ...serviceInput(),
    idempotencyKey: createRefundIdempotencyKey("payment-1"),
  };
}

function serviceInput() {
  return {
    paymentId: "payment-1",
    orderId: "order-1",
    sagaId: "saga-1",
    commandEventId: "command-1",
    correlationId: "correlation-1",
    reason: "order cancellation",
  };
}

function providerFake(): jest.Mocked<PaymentProvider> {
  return {
    createPreference: jest.fn(),
    getPayment: jest.fn(),
    refundPayment: jest.fn(),
  };
}

function request(eventId: string) {
  return {
    eventId,
    eventName: "payment.refund.requested",
    eventVersion: 1,
    occurredAt: "2026-07-25T10:00:00.000Z",
    correlationId: `correlation-${eventId}`,
    causationId: "cause-1",
    sagaId: "saga-1",
    orderId: "order-1",
    payload: {
      paymentId: "payment-1",
      reason: "order cancellation",
    },
  };
}
