import { MongoClient } from "mongodb";
import { PaymentWebhookEvent } from "../../src/payment/domain/entities/payment-webhook-event.entity";
import { PaymentWebhookEventStatus } from "../../src/payment/domain/enums/payment-webhook-event-status.enum";
import { MongoPaymentWebhookEventRepository } from "../../src/payment/infrastructure/repositories/mongo-payment-webhook-event.repository";

describe("MongoPaymentWebhookEventRepository", () => {
  it("uses payment_webhooks with a unique provider notification ID", async () => {
    const event = webhookEvent();
    const document = toDocument(event);
    const collection = {
      createIndex: jest
        .fn()
        .mockResolvedValue("payment_webhook_provider_notification_id_unique"),
      findOne: jest.fn().mockResolvedValue(document),
      findOneAndUpdate: jest.fn().mockResolvedValue(document),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const client = {
      db: jest
        .fn()
        .mockReturnValue({ collection: jest.fn().mockReturnValue(collection) }),
    } as unknown as MongoClient;
    const repository = new MongoPaymentWebhookEventRepository(client);

    await expect(
      repository.findByProviderNotificationId(event.providerNotificationId),
    ).resolves.toMatchObject({ id: event.id });
    await expect(repository.createIfAbsent(event)).resolves.toMatchObject({
      id: event.id,
    });
    await expect(
      repository.claimForProcessing(event.providerNotificationId),
    ).resolves.toMatchObject({ id: event.id });
    await expect(repository.save(event)).resolves.toBe(event);

    expect(collection.createIndex).toHaveBeenCalledWith(
      { providerNotificationId: 1 },
      {
        unique: true,
        name: "payment_webhook_provider_notification_id_unique",
      },
    );
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { providerNotificationId: event.providerNotificationId },
      expect.objectContaining({ $setOnInsert: expect.any(Object) }),
      { upsert: true, returnDocument: "after" },
    );
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        providerNotificationId: event.providerNotificationId,
        status: expect.objectContaining({
          $in: [
            PaymentWebhookEventStatus.RECEIVED,
            PaymentWebhookEventStatus.FAILED,
          ],
        }),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: PaymentWebhookEventStatus.PROCESSING,
        }),
      }),
      { returnDocument: "after" },
    );
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { providerNotificationId: event.providerNotificationId },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ signatureValidation: "VALID" }),
      }),
      { upsert: true, returnDocument: "after" },
    );
  });

  it("keeps a newly received event when an upsert returns no document", async () => {
    const event = webhookEvent();
    const collection = {
      createIndex: jest.fn().mockResolvedValue("index"),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    };
    const client = {
      db: jest
        .fn()
        .mockReturnValue({ collection: jest.fn().mockReturnValue(collection) }),
    } as unknown as MongoClient;
    const repository = new MongoPaymentWebhookEventRepository(client);

    await expect(repository.createIfAbsent(event)).resolves.toMatchObject({
      providerNotificationId: event.providerNotificationId,
      signatureValidation: "VALID",
    });
  });

  it("returns null when no stored or claimable event exists", async () => {
    const collection = {
      createIndex: jest.fn().mockResolvedValue("index"),
      findOne: jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    };
    const client = {
      db: jest
        .fn()
        .mockReturnValue({ collection: jest.fn().mockReturnValue(collection) }),
    } as unknown as MongoClient;
    const repository = new MongoPaymentWebhookEventRepository(client);

    await expect(
      repository.findByProviderNotificationId("missing-notification"),
    ).resolves.toBeNull();
    await expect(
      repository.claimForProcessing("missing-notification"),
    ).resolves.toBeNull();
  });
});

function webhookEvent(): PaymentWebhookEvent {
  return PaymentWebhookEvent.receive({
    id: "event-1",
    providerNotificationId: "notification-1",
    providerPaymentId: "provider-payment-1",
    type: "payment",
    action: "payment.updated",
    rawPayload: { id: "notification-1" },
  });
}

function toDocument(event: PaymentWebhookEvent) {
  return {
    _id: event.id,
    providerNotificationId: event.providerNotificationId,
    providerPaymentId: event.providerPaymentId,
    type: event.type,
    action: event.action,
    externalReference: event.externalReference,
    rawPayload: event.rawPayload,
    signatureValidation: event.signatureValidation,
    status: event.status,
    error: event.error,
    receivedAt: event.receivedAt,
    processedAt: event.processedAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}
