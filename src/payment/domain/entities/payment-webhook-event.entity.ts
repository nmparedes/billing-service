import { randomUUID } from "crypto";
import { PaymentWebhookEventStatus } from "../enums/payment-webhook-event-status.enum";

export interface ReceivePaymentWebhookEventProps {
  id?: string;
  providerNotificationId: string;
  providerPaymentId: string;
  type: "payment";
  action: string;
  rawPayload: Record<string, unknown>;
  receivedAt?: Date;
}

export interface RestorePaymentWebhookEventProps {
  id: string;
  providerNotificationId: string;
  providerPaymentId?: string;
  type: "payment";
  action: string;
  externalReference?: string;
  rawPayload: Record<string, unknown>;
  signatureValidation: "VALID";
  status: PaymentWebhookEventStatus;
  error?: string;
  receivedAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class PaymentWebhookEvent {
  private constructor(
    private readonly props: RestorePaymentWebhookEventProps,
  ) {}

  static receive(props: ReceivePaymentWebhookEventProps): PaymentWebhookEvent {
    const receivedAt = props.receivedAt ?? new Date();
    return new PaymentWebhookEvent({
      id: props.id ?? randomUUID(),
      providerNotificationId: props.providerNotificationId,
      providerPaymentId: props.providerPaymentId,
      type: props.type,
      action: props.action,
      rawPayload: props.rawPayload,
      signatureValidation: "VALID",
      status: PaymentWebhookEventStatus.RECEIVED,
      receivedAt,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    });
  }

  static restore(props: RestorePaymentWebhookEventProps): PaymentWebhookEvent {
    return new PaymentWebhookEvent(props);
  }

  markProcessed(externalReference: string, providerPaymentId: string): void {
    this.props.externalReference = externalReference;
    this.props.providerPaymentId = providerPaymentId;
    this.props.status = PaymentWebhookEventStatus.PROCESSED;
    this.props.error = undefined;
    this.props.processedAt = new Date();
    this.touch();
  }

  markFailed(error: string): void {
    this.props.status = PaymentWebhookEventStatus.FAILED;
    this.props.error = error;
    this.touch();
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }

  get id(): string {
    return this.props.id;
  }
  get providerNotificationId(): string {
    return this.props.providerNotificationId;
  }
  get providerPaymentId(): string | undefined {
    return this.props.providerPaymentId;
  }
  get type(): "payment" {
    return this.props.type;
  }
  get action(): string {
    return this.props.action;
  }
  get externalReference(): string | undefined {
    return this.props.externalReference;
  }
  get rawPayload(): Record<string, unknown> {
    return this.props.rawPayload;
  }
  get signatureValidation(): "VALID" {
    return this.props.signatureValidation;
  }
  get status(): PaymentWebhookEventStatus {
    return this.props.status;
  }
  get error(): string | undefined {
    return this.props.error;
  }
  get receivedAt(): Date {
    return this.props.receivedAt;
  }
  get processedAt(): Date | undefined {
    return this.props.processedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
