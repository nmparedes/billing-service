import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { Collection, MongoClient } from "mongodb";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { MONGO_CLIENT } from "../../../database/database.constants";
import {
  Payment,
  RestorePaymentProps,
} from "../../domain/entities/payment.entity";
import { PaymentStatus } from "../../domain/enums/payment-status.enum";
import type {
  PaymentRepository,
  RefundClaimInput,
  RefundClaimResult,
} from "../../domain/repositories/payment.repository.interface";

type NullableRefundString =
  | "refundCommandEventId"
  | "refundCorrelationId"
  | "refundIdempotencyKey"
  | "refundReason"
  | "refundProcessingToken"
  | "providerRefundId"
  | "providerPaymentId"
  | "refundFailureCode";

interface PaymentDocument extends Omit<
  RestorePaymentProps,
  "id" | NullableRefundString
> {
  _id: string;
  preferenceCreationInProgress?: boolean;
  preferenceCreationLeaseExpiresAt?: Date | null;
  refundCommandEventId?: string | null;
  refundCorrelationId?: string | null;
  refundIdempotencyKey?: string | null;
  refundReason?: string | null;
  refundProcessingToken?: string | null;
  providerRefundId?: string | null;
  providerPaymentId?: string | null;
  refundFailureCode?: string | null;
}

@Injectable()
export class MongoPaymentRepository implements PaymentRepository {
  constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    private readonly config: ConfigService,
  ) {}

  async findById(id: string): Promise<Payment | null> {
    const document = await (await this.collection()).findOne({ _id: id });
    return document ? this.toDomain(document) : null;
  }

  async findByBudgetId(budgetId: string): Promise<Payment | null> {
    const document = await (await this.collection()).findOne({ budgetId });
    return document ? this.toDomain(document) : null;
  }

  async findByExternalReference(
    externalReference: string,
  ): Promise<Payment | null> {
    const document = await (
      await this.collection()
    ).findOne({ externalReference });
    return document ? this.toDomain(document) : null;
  }

  async createIfAbsent(payment: Payment): Promise<Payment> {
    const document = await (
      await this.collection()
    ).findOneAndUpdate(
      { budgetId: payment.budgetId },
      { $setOnInsert: this.toDocument(payment) },
      { upsert: true, returnDocument: "after" },
    );
    return this.toDomain(document ?? this.toDocument(payment));
  }

  async tryClaimPreferenceCreation(paymentId: string): Promise<boolean> {
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() +
        this.config.get<number>("PAYMENT_PREFERENCE_LEASE_MS", 300000),
    );
    const result = await (
      await this.collection()
    ).updateOne(
      {
        _id: paymentId,
        providerPreferenceId: { $exists: false },
        $or: [
          { preferenceCreationInProgress: { $ne: true } },
          { preferenceCreationLeaseExpiresAt: null },
          { preferenceCreationLeaseExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: {
          preferenceCreationInProgress: true,
          preferenceCreationLeaseExpiresAt: leaseExpiresAt,
          updatedAt: now,
        },
      },
    );
    return result.matchedCount === 1;
  }

  async releasePreferenceCreation(paymentId: string): Promise<void> {
    await (
      await this.collection()
    ).updateOne(
      { _id: paymentId },
      {
        $unset: {
          preferenceCreationInProgress: "",
          preferenceCreationLeaseExpiresAt: "",
        },
      },
    );
  }

  async save(payment: Payment): Promise<Payment> {
    await (
      await this.collection()
    ).updateOne(
      { _id: payment.id },
      {
        $set: this.toDocument(payment),
        $unset: {
          preferenceCreationInProgress: "",
          preferenceCreationLeaseExpiresAt: "",
        },
      },
    );
    return payment;
  }

  async claimRefund(input: RefundClaimInput): Promise<RefundClaimResult> {
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() +
        this.config.get<number>("PAYMENT_REFUND_LEASE_MS", 300000),
    );
    const claimToken = randomUUID();
    const collection = await this.collection();
    const alreadyRefunded = await collection.findOneAndUpdate(
      {
        _id: input.paymentId,
        orderId: input.orderId,
        sagaId: input.sagaId,
        status: PaymentStatus.REFUNDED,
        $and: this.refundContextFilter(input),
      },
      [
        {
          $set: {
            ...this.refundContextUpdate(input, now),
            updatedAt: "$updatedAt",
          },
        },
      ],
      { returnDocument: "after" },
    );
    if (alreadyRefunded) {
      return {
        outcome: "REFUNDED",
        payment: this.toDomain(alreadyRefunded),
      };
    }

    const claimed = await collection.findOneAndUpdate(
      {
        _id: input.paymentId,
        orderId: input.orderId,
        sagaId: input.sagaId,
        status: PaymentStatus.APPROVED,
        $and: [
          ...this.refundContextFilter(input),
          {
            $or: [
              { refundProcessingToken: null },
              { refundLeaseExpiresAt: { $lte: now } },
            ],
          },
        ],
      },
      [
        {
          $set: {
            ...this.refundContextUpdate(input, now),
            refundProcessingToken: claimToken,
            refundProcessingStartedAt: now,
            refundLeaseExpiresAt: leaseExpiresAt,
            updatedAt: now,
          },
        },
        { $unset: ["refundFailureCode", "refundFailedAt"] },
      ],
      { returnDocument: "after" },
    );
    if (claimed) {
      return {
        outcome: "CLAIMED",
        payment: this.toDomain(claimed),
        claimToken,
      };
    }

    const current = await collection.findOne({ _id: input.paymentId });
    if (!current) {
      throw new DomainException(
        "PAYMENT_NOT_FOUND",
        `Payment ${input.paymentId} was not found.`,
      );
    }
    const payment = this.toDomain(current);
    this.assertRefundIdentity(payment, input);
    if (payment.status === PaymentStatus.REFUNDED) {
      return { outcome: "REFUNDED", payment };
    }
    if (payment.refundProcessingToken) {
      return { outcome: "BUSY", payment };
    }
    throw new DomainException(
      "PAYMENT_REFUND_NOT_ALLOWED",
      "Only an approved provider payment can be refunded.",
    );
  }

  async completeRefund(
    paymentId: string,
    claimToken: string,
    providerRefundId: string,
    refundedAt: Date,
  ): Promise<Payment> {
    const collection = await this.collection();
    const updated = await collection.findOneAndUpdate(
      {
        _id: paymentId,
        refundProcessingToken: claimToken,
        status: PaymentStatus.APPROVED,
        $or: [{ providerRefundId: null }, { providerRefundId }],
      },
      {
        $set: {
          providerRefundId,
          providerStatus: "refunded",
          status: PaymentStatus.REFUNDED,
          refundedAt,
          updatedAt: refundedAt,
        },
        $unset: {
          refundProcessingToken: "",
          refundProcessingStartedAt: "",
          refundLeaseExpiresAt: "",
          refundFailureCode: "",
          refundFailedAt: "",
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      throw new DomainException(
        "PAYMENT_REFUND_CLAIM_LOST",
        "The payment refund claim is no longer owned by this worker.",
      );
    }
    return this.toDomain(updated);
  }

  async releaseRefundClaim(
    paymentId: string,
    claimToken: string,
  ): Promise<boolean> {
    const result = await (
      await this.collection()
    ).updateOne(
      { _id: paymentId, refundProcessingToken: claimToken },
      {
        $unset: {
          refundProcessingToken: "",
          refundProcessingStartedAt: "",
          refundLeaseExpiresAt: "",
        },
        $set: { updatedAt: new Date() },
      },
    );
    return result.modifiedCount === 1;
  }

  async rejectRefund(
    paymentId: string,
    claimToken: string,
    failureCode: string,
    failedAt: Date,
  ): Promise<Payment> {
    this.assertFailureCode(failureCode);
    const updated = await (
      await this.collection()
    ).findOneAndUpdate(
      { _id: paymentId, refundProcessingToken: claimToken },
      {
        $set: {
          refundFailureCode: failureCode,
          refundFailedAt: failedAt,
          updatedAt: failedAt,
        },
        $unset: {
          refundProcessingToken: "",
          refundProcessingStartedAt: "",
          refundLeaseExpiresAt: "",
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      throw new DomainException(
        "PAYMENT_REFUND_CLAIM_LOST",
        "The payment refund claim is no longer owned by this worker.",
      );
    }
    return this.toDomain(updated);
  }

  async rejectRefundRequest(
    input: RefundClaimInput,
    failureCode: string,
    failedAt: Date,
  ): Promise<Payment> {
    this.assertFailureCode(failureCode);
    const collection = await this.collection();
    const updated = await collection.findOneAndUpdate(
      {
        _id: input.paymentId,
        orderId: input.orderId,
        sagaId: input.sagaId,
        $or: [
          {
            status: {
              $nin: [PaymentStatus.APPROVED, PaymentStatus.REFUNDED],
            },
          },
          {
            status: PaymentStatus.APPROVED,
            providerPaymentId: null,
          },
        ],
        refundProcessingToken: null,
        $and: [
          ...this.refundContextFilter(input),
          {
            $or: [
              { refundFailureCode: null },
              { refundFailureCode: failureCode },
            ],
          },
        ],
      },
      [
        {
          $set: {
            ...this.refundContextUpdate(input, failedAt),
            refundFailureCode: {
              $ifNull: ["$refundFailureCode", failureCode],
            },
            refundFailedAt: {
              $ifNull: ["$refundFailedAt", failedAt],
            },
            updatedAt: {
              $cond: [
                { $eq: [{ $ifNull: ["$refundFailureCode", null] }, null] },
                failedAt,
                "$updatedAt",
              ],
            },
          },
        },
      ],
      { returnDocument: "after" },
    );
    if (updated) return this.toDomain(updated);

    const current = await collection.findOne({ _id: input.paymentId });
    if (!current) {
      throw new DomainException(
        "PAYMENT_NOT_FOUND",
        `Payment ${input.paymentId} was not found.`,
      );
    }
    const payment = this.toDomain(current);
    this.assertRefundIdentity(payment, input);
    if (payment.refundFailureCode === failureCode && payment.refundFailedAt) {
      return payment;
    }
    if (payment.refundProcessingToken) {
      throw new DomainException(
        "PAYMENT_REFUND_IN_PROGRESS",
        "The payment refund is already being processed.",
      );
    }
    throw new DomainException(
      "PAYMENT_REFUND_REJECTION_CONFLICT",
      "The payment refund rejection conflicts with persisted state.",
    );
  }

  private async collection(): Promise<Collection<PaymentDocument>> {
    const collection = this.client.db().collection<PaymentDocument>("payments");
    await collection.createIndex(
      { budgetId: 1 },
      { unique: true, name: "payment_budget_unique" },
    );
    return collection;
  }

  private toDomain(document: PaymentDocument): Payment {
    const { _id, ...documentWithoutId } = document;
    const {
      preferenceCreationInProgress,
      preferenceCreationLeaseExpiresAt,
      ...props
    } = documentWithoutId;
    void preferenceCreationInProgress;
    void preferenceCreationLeaseExpiresAt;
    return Payment.restore({
      id: _id,
      ...props,
      refundCommandEventId: props.refundCommandEventId ?? undefined,
      refundCorrelationId: props.refundCorrelationId ?? undefined,
      refundIdempotencyKey: props.refundIdempotencyKey ?? undefined,
      refundReason: props.refundReason ?? undefined,
      refundProcessingToken: props.refundProcessingToken ?? undefined,
      providerRefundId: props.providerRefundId ?? undefined,
      providerPaymentId: props.providerPaymentId ?? undefined,
      refundFailureCode: props.refundFailureCode ?? undefined,
    });
  }

  private assertRefundIdentity(
    payment: Payment,
    input: RefundClaimInput,
  ): void {
    if (payment.orderId !== input.orderId || payment.sagaId !== input.sagaId) {
      throw new DomainException(
        "PAYMENT_REFUND_IDENTITY_MISMATCH",
        "The refund command does not match the local payment.",
      );
    }
    if (
      payment.refundCommandEventId &&
      payment.refundCommandEventId !== input.commandEventId
    ) {
      throw new DomainException(
        "PAYMENT_REFUND_CONTEXT_CONFLICT",
        "A payment refund cannot be replaced by another command.",
      );
    }
    if (
      payment.refundCorrelationId &&
      payment.refundCorrelationId !== input.correlationId
    ) {
      throw new DomainException(
        "PAYMENT_REFUND_CONTEXT_CONFLICT",
        "A payment refund cannot replace its persisted correlation context.",
      );
    }
    if (
      (payment.refundIdempotencyKey &&
        payment.refundIdempotencyKey !== input.idempotencyKey) ||
      (payment.refundReason && payment.refundReason !== input.reason)
    ) {
      throw new DomainException(
        "PAYMENT_REFUND_CONTEXT_CONFLICT",
        "A payment refund cannot replace its persisted command context.",
      );
    }
  }

  private refundContextFilter(input: RefundClaimInput) {
    return [
      {
        $or: [
          { refundCommandEventId: null },
          { refundCommandEventId: input.commandEventId },
        ],
      },
      {
        $or: [
          { refundCorrelationId: null },
          { refundCorrelationId: input.correlationId },
        ],
      },
      {
        $or: [
          { refundIdempotencyKey: null },
          { refundIdempotencyKey: input.idempotencyKey },
        ],
      },
      {
        $or: [{ refundReason: null }, { refundReason: input.reason }],
      },
    ];
  }

  private refundContextUpdate(input: RefundClaimInput, occurredAt: Date) {
    return {
      refundCommandEventId: {
        $ifNull: ["$refundCommandEventId", input.commandEventId],
      },
      refundCorrelationId: {
        $ifNull: ["$refundCorrelationId", input.correlationId],
      },
      refundIdempotencyKey: {
        $ifNull: ["$refundIdempotencyKey", input.idempotencyKey],
      },
      refundReason: { $ifNull: ["$refundReason", input.reason] },
      refundRequestedAt: {
        $ifNull: ["$refundRequestedAt", occurredAt],
      },
    };
  }

  private assertFailureCode(failureCode: string): void {
    if (!/^[A-Z0-9_]{1,64}$/.test(failureCode)) {
      throw new DomainException(
        "PAYMENT_REFUND_FAILURE_CODE_INVALID",
        "The refund failure code is invalid.",
      );
    }
  }

  private toDocument(payment: Payment): PaymentDocument {
    return {
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
      refundCommandEventId: payment.refundCommandEventId,
      refundCorrelationId: payment.refundCorrelationId,
      refundIdempotencyKey: payment.refundIdempotencyKey,
      refundReason: payment.refundReason,
      refundRequestedAt: payment.refundRequestedAt,
      refundProcessingToken: payment.refundProcessingToken,
      refundProcessingStartedAt: payment.refundProcessingStartedAt,
      refundLeaseExpiresAt: payment.refundLeaseExpiresAt,
      refundedAt: payment.refundedAt,
      providerRefundId: payment.providerRefundId,
      refundFailureCode: payment.refundFailureCode,
      refundFailedAt: payment.refundFailedAt,
      updatedAt: payment.updatedAt,
    };
  }
}
