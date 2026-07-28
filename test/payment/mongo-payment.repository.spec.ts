import { ConfigService } from "@nestjs/config";
import { MongoClient } from "mongodb";
import { Payment } from "../../src/payment/domain/entities/payment.entity";
import { MongoPaymentRepository } from "../../src/payment/infrastructure/repositories/mongo-payment.repository";

describe("MongoPaymentRepository", () => {
  it("uses the payments collection, a unique budget key and preference claim", async () => {
    const payment = createPayment();
    const document = {
      _id: payment.id,
      budgetId: payment.budgetId,
      orderId: payment.orderId,
      sagaId: payment.sagaId,
      externalReference: payment.externalReference,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      providerPreferenceId: payment.providerPreferenceId,
      providerPaymentId: payment.providerPaymentId,
      providerStatus: payment.providerStatus,
      checkoutUrl: payment.checkoutUrl,
      createdAt: payment.createdAt,
      approvedAt: payment.approvedAt,
      failedAt: payment.failedAt,
      updatedAt: payment.updatedAt,
    };
    const collection = {
      createIndex: jest.fn().mockResolvedValue("payment_budget_unique"),
      findOne: jest.fn().mockResolvedValue(document),
      findOneAndUpdate: jest.fn().mockResolvedValue(document),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const client = {
      db: jest
        .fn()
        .mockReturnValue({ collection: jest.fn().mockReturnValue(collection) }),
    } as unknown as MongoClient;
    const repository = new MongoPaymentRepository(
      client,
      new ConfigService({ PAYMENT_REFUND_LEASE_MS: 300000 }),
    );

    await expect(repository.findById(payment.id)).resolves.toMatchObject({
      id: payment.id,
    });
    await expect(
      repository.findByBudgetId(payment.budgetId),
    ).resolves.toMatchObject({
      id: payment.id,
    });
    await expect(
      repository.findByExternalReference(payment.externalReference),
    ).resolves.toMatchObject({
      id: payment.id,
    });
    await expect(repository.createIfAbsent(payment)).resolves.toMatchObject({
      id: payment.id,
    });
    await expect(
      repository.tryClaimPreferenceCreation(payment.id),
    ).resolves.toBe(true);
    await expect(
      repository.releasePreferenceCreation(payment.id),
    ).resolves.toBeUndefined();
    await expect(repository.save(payment)).resolves.toBe(payment);

    expect(collection.createIndex).toHaveBeenCalledWith(
      { budgetId: 1 },
      { unique: true, name: "payment_budget_unique" },
    );
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { budgetId: payment.budgetId },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ _id: payment.id }),
      }),
      { upsert: true, returnDocument: "after" },
    );
    expect(collection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: payment.id }),
      expect.objectContaining({
        $set: expect.objectContaining({ preferenceCreationInProgress: true }),
      }),
    );

    collection.findOne.mockResolvedValueOnce(null);
    await expect(repository.findById("missing")).resolves.toBeNull();
  });
});

function createPayment(): Payment {
  const payment = Payment.create({
    id: "payment-1",
    budgetId: "budget-1",
    orderId: "order-1",
    sagaId: "saga-1",
    amount: 400,
  });
  payment.assignPreference(
    "preference-1",
    "https://checkout.test/preference-1",
  );
  payment.updateProviderPayment("provider-payment-1", "approved");
  payment.applyProviderStatus("APPROVED" as never);
  return payment;
}
