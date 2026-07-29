import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { PaymentWebhookEvent } from "../../domain/entities/payment-webhook-event.entity";
import { PaymentStatus } from "../../domain/enums/payment-status.enum";
import { PaymentWebhookEventStatus } from "../../domain/enums/payment-webhook-event-status.enum";
import type { PaymentProvider } from "../../domain/providers/payment-provider.interface";
import type { PaymentRepository } from "../../domain/repositories/payment.repository.interface";
import type { PaymentWebhookEventRepository } from "../../domain/repositories/payment-webhook-event.repository.interface";
import {
  PAYMENT_PROVIDER,
  PAYMENT_REPOSITORY,
  PAYMENT_WEBHOOK_EVENT_REPOSITORY,
} from "../../payment.tokens";
import {
  BILLING_EVENT_PUBLISHER,
  BillingEventPublisher,
} from "../ports/billing-event-publisher.interface";
import {
  PAYMENT_WEBHOOK_AUTHENTICATOR,
  PaymentWebhookAuthenticator,
} from "../ports/payment-webhook-authenticator.interface";

export interface HandleMercadoPagoWebhookInput {
  signature?: string;
  requestId?: string;
  type?: string;
  providerNotificationId?: string;
  providerPaymentId?: string;
  action?: string;
  usesLegacyTopicQueryFormat?: boolean;
  rawPayload: Record<string, unknown>;
}

@Injectable()
export class PaymentWebhookService {
  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: PaymentRepository,
    @Inject(PAYMENT_WEBHOOK_EVENT_REPOSITORY)
    private readonly eventRepository: PaymentWebhookEventRepository,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    @Inject(PAYMENT_WEBHOOK_AUTHENTICATOR)
    private readonly signatureValidator: PaymentWebhookAuthenticator,
    @Inject(BILLING_EVENT_PUBLISHER)
    private readonly billingEvents: BillingEventPublisher,
  ) {}

  async handle(input: HandleMercadoPagoWebhookInput): Promise<void> {
    this.validateNotification(input);

    const event = await this.eventRepository.createIfAbsent(
      PaymentWebhookEvent.receive({
        providerNotificationId: input.providerNotificationId!,
        providerPaymentId: input.providerPaymentId!,
        type: "payment",
        action: input.action!,
        rawPayload: input.rawPayload,
      }),
    );

    if (event.status === PaymentWebhookEventStatus.PROCESSED) {
      return;
    }

    const claimed = await this.eventRepository.claimForProcessing(
      event.providerNotificationId,
    );
    if (!claimed) {
      const current = await this.eventRepository.findByProviderNotificationId(
        event.providerNotificationId,
      );
      if (current?.status === PaymentWebhookEventStatus.PROCESSED) {
        return;
      }
      throw new DomainException(
        "WEBHOOK_EVENT_CONFLICT",
        "The payment webhook event is already being processed.",
      );
    }

    try {
      const providerPayment = await this.paymentProvider.getPayment(
        input.providerPaymentId!,
      );
      if (!providerPayment.externalReference) {
        throw new DomainException(
          "PAYMENT_EXTERNAL_REFERENCE_MISSING",
          "The provider payment does not contain an external reference.",
        );
      }

      const payment = await this.paymentRepository.findByExternalReference(
        providerPayment.externalReference,
      );
      if (!payment) {
        throw new DomainException(
          "PAYMENT_NOT_FOUND",
          "No local payment matches the provider external reference.",
        );
      }

      const status = this.mapProviderStatus(providerPayment.status);
      const providerPaymentChanged = payment.updateProviderPayment(
        providerPayment.providerPaymentId,
        providerPayment.status,
      );
      const statusChanged = payment.applyProviderStatus(status);
      if (providerPaymentChanged || statusChanged) {
        await this.paymentRepository.save(payment);
      }

      const retryingFailedEvent =
        event.status === PaymentWebhookEventStatus.FAILED;
      if (
        (statusChanged || retryingFailedEvent) &&
        status === PaymentStatus.APPROVED
      ) {
        await this.billingEvents.publishPaymentApproved(
          payment,
          input.providerNotificationId!,
          input.providerPaymentId!,
        );
      }
      if (
        (statusChanged || retryingFailedEvent) &&
        status === PaymentStatus.FAILED
      ) {
        await this.billingEvents.publishPaymentFailed(
          payment,
          input.providerNotificationId!,
          input.providerPaymentId!,
        );
      }

      claimed.markProcessed(
        providerPayment.externalReference,
        providerPayment.providerPaymentId,
      );
      await this.eventRepository.save(claimed);
    } catch (error: unknown) {
      claimed.markFailed(this.sanitizeError(error));
      await this.eventRepository.save(claimed);

      if (error instanceof DomainException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        "The payment provider is temporarily unavailable.",
      );
    }
  }

  private validateNotification(input: HandleMercadoPagoWebhookInput): void {
    if (
      input.type !== "payment" ||
      !input.providerNotificationId ||
      !input.providerPaymentId ||
      !input.action
    ) {
      throw new DomainException(
        "WEBHOOK_INVALID_PAYLOAD",
        "The Mercado Pago webhook payload is invalid.",
      );
    }

    const validSignature = this.signatureValidator.validate({
      signature: input.signature,
      requestId: input.requestId,
      dataId: input.providerPaymentId,
      allowLegacyTestFallback: input.usesLegacyTopicQueryFormat,
    });
    if (!validSignature) {
      throw new DomainException(
        "WEBHOOK_SIGNATURE_UNAUTHORIZED",
        "The Mercado Pago webhook signature is invalid.",
      );
    }
  }

  private mapProviderStatus(status: string): PaymentStatus {
    const mapping: Record<string, PaymentStatus> = {
      pending: PaymentStatus.PENDING,
      in_process: PaymentStatus.PENDING,
      authorized: PaymentStatus.PENDING,
      approved: PaymentStatus.APPROVED,
      rejected: PaymentStatus.FAILED,
      cancelled: PaymentStatus.CANCELLED,
      refunded: PaymentStatus.REFUNDED,
      charged_back: PaymentStatus.CHARGED_BACK,
    };
    const mapped = mapping[status];
    if (!mapped) {
      throw new DomainException(
        "PAYMENT_PROVIDER_STATUS_UNSUPPORTED",
        "The provider payment status is not supported.",
      );
    }
    return mapped;
  }

  private sanitizeError(error: unknown): string {
    if (error instanceof DomainException) {
      return error.code;
    }
    return "PAYMENT_PROVIDER_UNAVAILABLE";
  }
}
