import { ConfigService } from "@nestjs/config";
import { MongoClient } from "mongodb";
import { PaymentStatus } from "../../src/payment/domain/enums/payment-status.enum";
import { MongoPaymentRepository } from "../../src/payment/infrastructure/repositories/mongo-payment.repository";

describe("MongoPaymentRepository refund operations", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => jest.useRealTimers());

  it("claims with an atomic lease and persisted immutable context", async () => {
    const document = paymentDocument({
      refundCommandEventId: "command-1",
      refundCorrelationId: "correlation-1",
      refundIdempotencyKey: "key-1",
      refundReason: "cancellation",
      refundRequestedAt: now,
      refundProcessingToken: "generated-token",
      refundProcessingStartedAt: now,
      refundLeaseExpiresAt: new Date(now.getTime() + 300000),
    });
    const { repository, collection } = createRepository();
    collection.findOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(document);

    const result = await repository.claimRefund(claimInput());

    expect(result).toMatchObject({ outcome: "CLAIMED" });
    expect(collection.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        _id: "payment-1",
        status: PaymentStatus.APPROVED,
        $and: expect.any(Array),
      }),
      expect.any(Array),
      { returnDocument: "after" },
    );
    const updatePipeline = collection.findOneAndUpdate.mock.calls[1][1];
    expect(updatePipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $set: expect.objectContaining({
            refundRequestedAt: {
              $ifNull: ["$refundRequestedAt", now],
            },
            refundLeaseExpiresAt: new Date(now.getTime() + 300000),
          }),
        }),
      ]),
    );
  });

  it("reports a valid concurrent lease and recovers through the atomic filter", async () => {
    const { repository, collection } = createRepository();
    collection.findOneAndUpdate.mockResolvedValue(null);
    collection.findOne.mockResolvedValue(
      paymentDocument({
        refundCommandEventId: "command-1",
        refundCorrelationId: "correlation-1",
        refundIdempotencyKey: "key-1",
        refundReason: "cancellation",
        refundProcessingToken: "other-worker",
        refundProcessingStartedAt: now,
        refundLeaseExpiresAt: new Date(now.getTime() + 300000),
      }),
    );

    await expect(repository.claimRefund(claimInput())).resolves.toMatchObject({
      outcome: "BUSY",
    });
    expect(collection.findOneAndUpdate.mock.calls[1][0].$and).toEqual(
      expect.arrayContaining([
        {
          $or: [
            { refundProcessingToken: null },
            { refundLeaseExpiresAt: { $lte: now } },
          ],
        },
      ]),
    );
  });

  it("returns an already refunded payment without creating a claim", async () => {
    const { repository, collection } = createRepository();
    collection.findOneAndUpdate.mockResolvedValue(null);
    collection.findOne.mockResolvedValue(
      paymentDocument({
        status: PaymentStatus.REFUNDED,
        refundCommandEventId: "command-1",
        refundCorrelationId: "correlation-1",
        refundIdempotencyKey: "key-1",
        refundReason: "cancellation",
        providerRefundId: "refund-1",
        refundedAt: now,
      }),
    );

    await expect(repository.claimRefund(claimInput())).resolves.toMatchObject({
      outcome: "REFUNDED",
      payment: { providerRefundId: "refund-1" },
    });
  });

  it("rejects another command for the same payment", async () => {
    const { repository, collection } = createRepository();
    collection.findOneAndUpdate.mockResolvedValue(null);
    collection.findOne.mockResolvedValue(
      paymentDocument({ refundCommandEventId: "other-command" }),
    );

    await expect(repository.claimRefund(claimInput())).rejects.toMatchObject({
      code: "PAYMENT_REFUND_CONTEXT_CONFLICT",
    });
  });

  it("completes only with the current token and never replaces a refund ID", async () => {
    const { repository, collection } = createRepository();
    collection.findOneAndUpdate.mockResolvedValue(
      paymentDocument({
        status: PaymentStatus.REFUNDED,
        providerRefundId: "refund-1",
        refundedAt: now,
      }),
    );

    await expect(
      repository.completeRefund("payment-1", "token-1", "refund-1", now),
    ).resolves.toMatchObject({ providerRefundId: "refund-1" });
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "payment-1",
        refundProcessingToken: "token-1",
        $or: [{ providerRefundId: null }, { providerRefundId: "refund-1" }],
      }),
      expect.any(Object),
      { returnDocument: "after" },
    );

    collection.findOneAndUpdate.mockResolvedValueOnce(null);
    await expect(
      repository.completeRefund("payment-1", "stale", "refund-2", now),
    ).rejects.toMatchObject({ code: "PAYMENT_REFUND_CLAIM_LOST" });
  });

  it("releases and rejects only with the current worker token", async () => {
    const { repository, collection } = createRepository();
    collection.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await expect(
      repository.releaseRefundClaim("payment-1", "stale"),
    ).resolves.toBe(false);

    collection.findOneAndUpdate.mockResolvedValueOnce(null);
    await expect(
      repository.rejectRefund("payment-1", "stale", "NOT_ALLOWED", now),
    ).rejects.toMatchObject({ code: "PAYMENT_REFUND_CLAIM_LOST" });

    collection.findOneAndUpdate.mockResolvedValueOnce(
      paymentDocument({
        refundFailureCode: "NOT_ALLOWED",
        refundFailedAt: now,
      }),
    );
    await expect(
      repository.rejectRefund("payment-1", "current", "NOT_ALLOWED", now),
    ).resolves.toMatchObject({
      refundFailureCode: "NOT_ALLOWED",
      refundFailedAt: now,
    });
  });

  it("persists and replays a business rejection with immutable context", async () => {
    const rejected = paymentDocument({
      status: PaymentStatus.PENDING,
      refundCommandEventId: "command-1",
      refundCorrelationId: "correlation-1",
      refundIdempotencyKey: "key-1",
      refundReason: "cancellation",
      refundRequestedAt: now,
      refundFailureCode: "PAYMENT_NOT_APPROVED",
      refundFailedAt: now,
    });
    const { repository, collection } = createRepository();
    collection.findOneAndUpdate.mockResolvedValueOnce(rejected);

    await expect(
      repository.rejectRefundRequest(claimInput(), "PAYMENT_NOT_APPROVED", now),
    ).resolves.toMatchObject({
      refundFailureCode: "PAYMENT_NOT_APPROVED",
      refundFailedAt: now,
    });
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "payment-1",
        refundProcessingToken: null,
      }),
      expect.any(Array),
      { returnDocument: "after" },
    );

    collection.findOneAndUpdate.mockResolvedValueOnce(null);
    collection.findOne.mockResolvedValueOnce(rejected);
    await expect(
      repository.rejectRefundRequest(
        claimInput(),
        "PAYMENT_NOT_APPROVED",
        new Date("2026-07-25T13:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      refundFailedAt: now,
    });
  });

  it("rejects conflicting business rejection context and invalid codes", async () => {
    const { repository, collection } = createRepository();
    await expect(
      repository.rejectRefundRequest(claimInput(), "invalid-code", now),
    ).rejects.toMatchObject({
      code: "PAYMENT_REFUND_FAILURE_CODE_INVALID",
    });
    expect(collection.findOneAndUpdate).not.toHaveBeenCalled();

    collection.findOneAndUpdate.mockResolvedValueOnce(null);
    collection.findOne.mockResolvedValueOnce(
      paymentDocument({
        status: PaymentStatus.PENDING,
        refundCommandEventId: "another-command",
      }),
    );
    await expect(
      repository.rejectRefundRequest(claimInput(), "PAYMENT_NOT_APPROVED", now),
    ).rejects.toMatchObject({
      code: "PAYMENT_REFUND_CONTEXT_CONFLICT",
    });
  });

  it("propagates MongoDB failures", async () => {
    const { repository, collection } = createRepository();
    collection.findOneAndUpdate.mockRejectedValue(new Error("mongo down"));
    await expect(repository.claimRefund(claimInput())).rejects.toThrow(
      "mongo down",
    );
  });
});

function claimInput() {
  return {
    paymentId: "payment-1",
    orderId: "order-1",
    sagaId: "saga-1",
    commandEventId: "command-1",
    correlationId: "correlation-1",
    idempotencyKey: "key-1",
    reason: "cancellation",
  };
}

function paymentDocument(overrides: Record<string, unknown> = {}) {
  return {
    _id: "payment-1",
    budgetId: "budget-1",
    orderId: "order-1",
    sagaId: "saga-1",
    externalReference: "payment-1",
    amount: 100,
    currency: "BRL",
    status: PaymentStatus.APPROVED,
    providerPaymentId: "provider-payment-1",
    providerStatus: "approved",
    createdAt: new Date("2026-07-25T09:00:00.000Z"),
    approvedAt: new Date("2026-07-25T10:00:00.000Z"),
    updatedAt: new Date("2026-07-25T10:00:00.000Z"),
    ...overrides,
  };
}

function createRepository() {
  const collection = {
    createIndex: jest.fn().mockResolvedValue("payment_budget_unique"),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const client = {
    db: jest
      .fn()
      .mockReturnValue({ collection: jest.fn().mockReturnValue(collection) }),
  } as unknown as MongoClient;
  return {
    repository: new MongoPaymentRepository(
      client,
      new ConfigService({ PAYMENT_REFUND_LEASE_MS: 300000 }),
    ),
    collection,
  };
}
