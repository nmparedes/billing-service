import { Module } from "@nestjs/common";
import { BudgetModule } from "../budget/budget.module";
import { DatabaseModule } from "../database/database.module";
import { PaymentService } from "./application/services/payment.service";
import { PaymentWebhookService } from "./application/services/payment-webhook.service";
import { PaymentRefundService } from "./application/services/payment-refund.service";
import {
  PAYMENT_PROVIDER,
  PAYMENT_REPOSITORY,
  PAYMENT_WEBHOOK_EVENT_REPOSITORY,
} from "./payment.tokens";
import { MercadoPagoCheckoutProClient } from "./infrastructure/clients/mercado-pago-checkout-pro.client";
import { MercadoPagoConfigurationService } from "./infrastructure/config/mercado-pago-configuration.service";
import { MercadoPagoWebhookController } from "./infrastructure/controllers/mercado-pago-webhook.controller";
import { PaymentController } from "./infrastructure/controllers/payment.controller";
import { MongoPaymentRepository } from "./infrastructure/repositories/mongo-payment.repository";
import { MongoPaymentWebhookEventRepository } from "./infrastructure/repositories/mongo-payment-webhook-event.repository";
import { MercadoPagoWebhookSignatureValidator } from "./infrastructure/security/mercado-pago-webhook-signature.validator";
import { MercadoPagoPaymentWebhookAuthenticator } from "./infrastructure/security/mercado-pago-payment-webhook-authenticator";
import { BILLING_EVENT_PUBLISHER } from "./application/ports/billing-event-publisher.interface";
import { PAYMENT_WEBHOOK_AUTHENTICATOR } from "./application/ports/payment-webhook-authenticator.interface";
import { BillingEventsService } from "../messaging/billing-events.service";
import { MessagingModule } from "../messaging/rabbitmq-broker";
import { MongoConsumedMessageRepository } from "../messaging/consumed-message.repository";
import { PaymentRefundMessagingHandler } from "../messaging/payment-refund-messaging.handler";

@Module({
  imports: [BudgetModule, DatabaseModule, MessagingModule],
  controllers: [PaymentController, MercadoPagoWebhookController],
  providers: [
    PaymentService,
    PaymentWebhookService,
    PaymentRefundService,
    PaymentRefundMessagingHandler,
    MongoConsumedMessageRepository,
    MercadoPagoConfigurationService,
    MercadoPagoCheckoutProClient,
    MongoPaymentRepository,
    MongoPaymentWebhookEventRepository,
    MercadoPagoWebhookSignatureValidator,
    MercadoPagoPaymentWebhookAuthenticator,
    {
      provide: PAYMENT_PROVIDER,
      useExisting: MercadoPagoCheckoutProClient,
    },
    {
      provide: PAYMENT_REPOSITORY,
      useExisting: MongoPaymentRepository,
    },
    {
      provide: PAYMENT_WEBHOOK_EVENT_REPOSITORY,
      useExisting: MongoPaymentWebhookEventRepository,
    },
    {
      provide: PAYMENT_WEBHOOK_AUTHENTICATOR,
      useExisting: MercadoPagoPaymentWebhookAuthenticator,
    },
    {
      provide: BILLING_EVENT_PUBLISHER,
      useExisting: BillingEventsService,
    },
  ],
  exports: [PaymentRefundService],
})
export class PaymentModule {}
