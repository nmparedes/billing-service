import { PaymentWebhookEvent } from "../entities/payment-webhook-event.entity";

export interface PaymentWebhookEventRepository {
  findByProviderNotificationId(
    providerNotificationId: string,
  ): Promise<PaymentWebhookEvent | null>;
  createIfAbsent(event: PaymentWebhookEvent): Promise<PaymentWebhookEvent>;
  claimForProcessing(
    providerNotificationId: string,
  ): Promise<PaymentWebhookEvent | null>;
  save(event: PaymentWebhookEvent): Promise<PaymentWebhookEvent>;
}
