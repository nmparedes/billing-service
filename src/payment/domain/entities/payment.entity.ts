import { randomUUID } from "crypto";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { PaymentStatus } from "../enums/payment-status.enum";

export interface CreatePaymentProps {
  id?: string;
  budgetId: string;
  orderId: string;
  sagaId: string;
  amount: number;
  createdAt?: Date;
}

export interface RestorePaymentProps {
  id: string;
  budgetId: string;
  orderId: string;
  sagaId: string;
  externalReference: string;
  amount: number;
  currency: "BRL";
  status: PaymentStatus;
  providerPreferenceId?: string;
  providerPaymentId?: string;
  providerStatus?: string;
  checkoutUrl?: string;
  createdAt: Date;
  approvedAt?: Date;
  failedAt?: Date;
  refundCommandEventId?: string;
  refundCorrelationId?: string;
  refundIdempotencyKey?: string;
  refundReason?: string;
  refundRequestedAt?: Date;
  refundProcessingToken?: string;
  refundProcessingStartedAt?: Date;
  refundLeaseExpiresAt?: Date;
  refundedAt?: Date;
  providerRefundId?: string;
  refundFailureCode?: string;
  refundFailedAt?: Date;
  updatedAt: Date;
}

export class Payment {
  private constructor(private readonly props: RestorePaymentProps) {}

  static create(props: CreatePaymentProps): Payment {
    if (!Number.isFinite(props.amount) || props.amount <= 0) {
      throw new DomainException(
        "PAYMENT_INVALID_AMOUNT",
        "A payment amount must be greater than zero.",
      );
    }

    const id = props.id ?? randomUUID();
    const createdAt = props.createdAt ?? new Date();
    return new Payment({
      id,
      budgetId: props.budgetId,
      orderId: props.orderId,
      sagaId: props.sagaId,
      externalReference: id,
      amount: props.amount,
      currency: "BRL",
      status: PaymentStatus.PENDING,
      createdAt,
      updatedAt: createdAt,
    });
  }

  static restore(props: RestorePaymentProps): Payment {
    return new Payment({
      ...props,
      createdAt: new Date(props.createdAt),
      approvedAt: copyDate(props.approvedAt),
      failedAt: copyDate(props.failedAt),
      refundRequestedAt: copyDate(props.refundRequestedAt),
      refundProcessingStartedAt: copyDate(props.refundProcessingStartedAt),
      refundLeaseExpiresAt: copyDate(props.refundLeaseExpiresAt),
      refundedAt: copyDate(props.refundedAt),
      refundFailedAt: copyDate(props.refundFailedAt),
      updatedAt: new Date(props.updatedAt),
    });
  }

  assignPreference(providerPreferenceId: string, checkoutUrl: string): void {
    if (!providerPreferenceId || !checkoutUrl) {
      throw new DomainException(
        "PAYMENT_PROVIDER_INVALID_RESPONSE",
        "The payment provider did not return a preference ID and checkout URL.",
      );
    }
    if (this.props.providerPreferenceId) {
      if (this.props.providerPreferenceId !== providerPreferenceId) {
        throw new DomainException(
          "PAYMENT_PREFERENCE_ALREADY_ASSIGNED",
          "A payment cannot be assigned to multiple provider preferences.",
        );
      }
      return;
    }

    this.props.providerPreferenceId = providerPreferenceId;
    this.props.checkoutUrl = checkoutUrl;
    this.touch();
  }

  updateProviderPayment(
    providerPaymentId: string,
    providerStatus: string,
  ): boolean {
    if (!providerPaymentId || !providerStatus) {
      throw new DomainException(
        "PAYMENT_PROVIDER_INVALID_RESPONSE",
        "The payment provider did not return a payment ID.",
      );
    }
    if (this.props.providerPaymentId) {
      if (this.props.providerPaymentId !== providerPaymentId) {
        throw new DomainException(
          "PAYMENT_PROVIDER_PAYMENT_ALREADY_ASSIGNED",
          "A payment cannot be assigned to multiple provider payments.",
        );
      }
    }

    if (
      this.props.providerPaymentId === providerPaymentId &&
      this.props.providerStatus === providerStatus
    ) {
      return false;
    }

    this.props.providerPaymentId = providerPaymentId;
    this.props.providerStatus = providerStatus;
    this.touch();
    return true;
  }

  applyProviderStatus(status: PaymentStatus): boolean {
    if (this.props.status === status) {
      return false;
    }

    const allowedTransitions: Record<PaymentStatus, PaymentStatus[]> = {
      [PaymentStatus.PENDING]: [
        PaymentStatus.APPROVED,
        PaymentStatus.FAILED,
        PaymentStatus.CANCELLED,
      ],
      [PaymentStatus.APPROVED]: [
        PaymentStatus.REFUNDED,
        PaymentStatus.CHARGED_BACK,
      ],
      [PaymentStatus.FAILED]: [],
      [PaymentStatus.CANCELLED]: [],
      [PaymentStatus.REFUNDED]: [],
      [PaymentStatus.CHARGED_BACK]: [],
    };

    if (!allowedTransitions[this.props.status].includes(status)) {
      throw new DomainException(
        "PAYMENT_STATUS_TRANSITION_INVALID",
        `Payment status cannot transition from ${this.props.status} to ${status}.`,
      );
    }

    this.props.status = status;
    if (status === PaymentStatus.APPROVED) {
      this.props.approvedAt = new Date();
    }
    if (status === PaymentStatus.FAILED) {
      this.props.failedAt = new Date();
    }
    if (status === PaymentStatus.REFUNDED) {
      this.props.refundedAt = new Date();
    }
    this.touch();
    return true;
  }

  prepareRefund(input: {
    commandEventId: string;
    correlationId: string;
    idempotencyKey: string;
    reason: string;
    requestedAt: Date;
  }): boolean {
    const commandEventId = required(input.commandEventId, "command event ID");
    const correlationId = required(input.correlationId, "correlation ID");
    const idempotencyKey = required(input.idempotencyKey, "idempotency key");
    const reason = required(input.reason, "refund reason");
    if (this.props.refundCommandEventId) {
      if (
        this.props.refundCommandEventId !== commandEventId ||
        this.props.refundCorrelationId !== correlationId ||
        this.props.refundIdempotencyKey !== idempotencyKey ||
        this.props.refundReason !== reason
      ) {
        throw new DomainException(
          "PAYMENT_REFUND_CONTEXT_CONFLICT",
          "A payment refund cannot be replaced by another command.",
        );
      }
      return false;
    }
    if (this.props.status === PaymentStatus.REFUNDED) return false;
    if (
      this.props.status !== PaymentStatus.APPROVED ||
      !this.props.providerPaymentId
    ) {
      throw new DomainException(
        "PAYMENT_REFUND_NOT_ALLOWED",
        "Only an approved provider payment can be refunded.",
      );
    }

    this.props.refundCommandEventId = commandEventId;
    this.props.refundCorrelationId = correlationId;
    this.props.refundIdempotencyKey = idempotencyKey;
    this.props.refundReason = reason;
    this.props.refundRequestedAt = new Date(input.requestedAt);
    this.touch();
    return true;
  }

  markRefunded(providerRefundId: string, refundedAt: Date): boolean {
    providerRefundId = required(providerRefundId, "provider refund ID");
    if (!this.props.refundCommandEventId) {
      throw new DomainException(
        "PAYMENT_REFUND_CONTEXT_MISSING",
        "Refund context must be persisted before completion.",
      );
    }
    if (
      this.props.providerRefundId &&
      this.props.providerRefundId !== providerRefundId
    ) {
      throw new DomainException(
        "PAYMENT_REFUND_ALREADY_ASSIGNED",
        "A payment cannot be assigned to multiple provider refunds.",
      );
    }
    if (this.props.status === PaymentStatus.REFUNDED) return false;
    this.props.providerRefundId = providerRefundId;
    this.props.refundedAt = new Date(refundedAt);
    this.props.status = PaymentStatus.REFUNDED;
    this.props.refundFailureCode = undefined;
    this.props.refundFailedAt = undefined;
    this.touch();
    return true;
  }

  markRefundRejected(failureCode: string, failedAt: Date): boolean {
    failureCode = required(failureCode, "refund failure code");
    if (this.props.status === PaymentStatus.REFUNDED) {
      throw new DomainException(
        "PAYMENT_REFUND_ALREADY_COMPLETED",
        "A completed refund cannot be rejected.",
      );
    }
    if (
      this.props.refundFailureCode === failureCode &&
      this.props.refundFailedAt?.getTime() === failedAt.getTime()
    ) {
      return false;
    }
    this.props.refundFailureCode = failureCode;
    this.props.refundFailedAt = new Date(failedAt);
    this.touch();
    return true;
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }

  get id(): string {
    return this.props.id;
  }
  get budgetId(): string {
    return this.props.budgetId;
  }
  get orderId(): string {
    return this.props.orderId;
  }
  get sagaId(): string {
    return this.props.sagaId;
  }
  get externalReference(): string {
    return this.props.externalReference;
  }
  get amount(): number {
    return this.props.amount;
  }
  get currency(): "BRL" {
    return this.props.currency;
  }
  get status(): PaymentStatus {
    return this.props.status;
  }
  get providerPreferenceId(): string | undefined {
    return this.props.providerPreferenceId;
  }
  get providerPaymentId(): string | undefined {
    return this.props.providerPaymentId;
  }
  get providerStatus(): string | undefined {
    return this.props.providerStatus;
  }
  get checkoutUrl(): string | undefined {
    return this.props.checkoutUrl;
  }
  get createdAt(): Date {
    return new Date(this.props.createdAt);
  }
  get approvedAt(): Date | undefined {
    return copyDate(this.props.approvedAt);
  }
  get failedAt(): Date | undefined {
    return copyDate(this.props.failedAt);
  }
  get refundCommandEventId(): string | undefined {
    return this.props.refundCommandEventId;
  }
  get refundCorrelationId(): string | undefined {
    return this.props.refundCorrelationId;
  }
  get refundIdempotencyKey(): string | undefined {
    return this.props.refundIdempotencyKey;
  }
  get refundReason(): string | undefined {
    return this.props.refundReason;
  }
  get refundRequestedAt(): Date | undefined {
    return copyDate(this.props.refundRequestedAt);
  }
  get refundProcessingToken(): string | undefined {
    return this.props.refundProcessingToken;
  }
  get refundProcessingStartedAt(): Date | undefined {
    return copyDate(this.props.refundProcessingStartedAt);
  }
  get refundLeaseExpiresAt(): Date | undefined {
    return copyDate(this.props.refundLeaseExpiresAt);
  }
  get refundedAt(): Date | undefined {
    return copyDate(this.props.refundedAt);
  }
  get providerRefundId(): string | undefined {
    return this.props.providerRefundId;
  }
  get refundFailureCode(): string | undefined {
    return this.props.refundFailureCode;
  }
  get refundFailedAt(): Date | undefined {
    return copyDate(this.props.refundFailedAt);
  }
  get updatedAt(): Date {
    return new Date(this.props.updatedAt);
  }
}

function copyDate(value?: Date): Date | undefined {
  return value ? new Date(value) : undefined;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new DomainException(
      "PAYMENT_REFUND_INVALID",
      `The ${field} is required.`,
    );
  }
  return normalized;
}
