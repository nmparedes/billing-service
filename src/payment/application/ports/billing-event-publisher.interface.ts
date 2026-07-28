import { PaymentStatus } from "../../domain/enums/payment-status.enum";

export interface BillingEventPublisher {
  publishPaymentApproved(
    payment: PaymentEvent,
    causationId: string,
    correlationId?: string,
  ): Promise<void>;
  publishPaymentFailed(
    payment: PaymentEvent,
    causationId: string,
    correlationId?: string,
  ): Promise<void>;
}

export interface PaymentEvent {
  id: string;
  budgetId: string;
  orderId: string;
  sagaId: string;
  status: PaymentStatus;
  createdAt: Date;
  approvedAt?: Date;
  failedAt?: Date;
  providerPaymentId?: string;
  checkoutUrl?: string;
}

export const BILLING_EVENT_PUBLISHER = Symbol("BILLING_EVENT_PUBLISHER");
