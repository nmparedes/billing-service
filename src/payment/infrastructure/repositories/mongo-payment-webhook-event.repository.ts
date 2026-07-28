import { Inject, Injectable } from "@nestjs/common";
import { Collection, MongoClient } from "mongodb";
import { MONGO_CLIENT } from "../../../database/database.constants";
import {
  PaymentWebhookEvent,
  RestorePaymentWebhookEventProps,
} from "../../domain/entities/payment-webhook-event.entity";
import { PaymentWebhookEventStatus } from "../../domain/enums/payment-webhook-event-status.enum";
import type { PaymentWebhookEventRepository } from "../../domain/repositories/payment-webhook-event.repository.interface";

interface PaymentWebhookEventDocument extends Omit<
  RestorePaymentWebhookEventProps,
  "id"
> {
  _id: string;
}

@Injectable()
export class MongoPaymentWebhookEventRepository implements PaymentWebhookEventRepository {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  async findByProviderNotificationId(
    providerNotificationId: string,
  ): Promise<PaymentWebhookEvent | null> {
    const document = await (
      await this.collection()
    ).findOne({ providerNotificationId });
    return document ? this.toDomain(document) : null;
  }

  async createIfAbsent(
    event: PaymentWebhookEvent,
  ): Promise<PaymentWebhookEvent> {
    const document = await (
      await this.collection()
    ).findOneAndUpdate(
      { providerNotificationId: event.providerNotificationId },
      { $setOnInsert: this.toDocument(event) },
      { upsert: true, returnDocument: "after" },
    );
    return this.toDomain(document ?? this.toDocument(event));
  }

  async claimForProcessing(
    providerNotificationId: string,
  ): Promise<PaymentWebhookEvent | null> {
    const document = await (
      await this.collection()
    ).findOneAndUpdate(
      {
        providerNotificationId,
        status: {
          $in: [
            PaymentWebhookEventStatus.RECEIVED,
            PaymentWebhookEventStatus.FAILED,
          ],
        },
      },
      {
        $set: {
          status: PaymentWebhookEventStatus.PROCESSING,
          error: undefined,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return document ? this.toDomain(document) : null;
  }

  async save(event: PaymentWebhookEvent): Promise<PaymentWebhookEvent> {
    await (
      await this.collection()
    ).updateOne({ _id: event.id }, { $set: this.toDocument(event) });
    return event;
  }

  private async collection(): Promise<Collection<PaymentWebhookEventDocument>> {
    const collection = this.client
      .db()
      .collection<PaymentWebhookEventDocument>("payment_webhooks");
    await collection.createIndex(
      { providerNotificationId: 1 },
      { unique: true, name: "payment_webhook_provider_notification_id_unique" },
    );
    return collection;
  }

  private toDomain(document: PaymentWebhookEventDocument): PaymentWebhookEvent {
    const { _id, ...props } = document;
    return PaymentWebhookEvent.restore({ id: _id, ...props });
  }

  private toDocument(event: PaymentWebhookEvent): PaymentWebhookEventDocument {
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
}
