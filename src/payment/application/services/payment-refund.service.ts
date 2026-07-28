import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { Payment } from "../../domain/entities/payment.entity";
import { PaymentStatus } from "../../domain/enums/payment-status.enum";
import type { PaymentProvider } from "../../domain/providers/payment-provider.interface";
import type { PaymentRepository } from "../../domain/repositories/payment.repository.interface";
import { PAYMENT_PROVIDER, PAYMENT_REPOSITORY } from "../../payment.tokens";

export interface PaymentRefundInput {
  paymentId: string;
  orderId: string;
  sagaId: string;
  commandEventId: string;
  correlationId: string;
  reason: string;
}

export type PaymentRefundResult =
  | { outcome: "REFUNDED"; payment: Payment }
  | { outcome: "REJECTED"; payment: Payment };

@Injectable()
export class PaymentRefundService {
  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER)
    private readonly provider: PaymentProvider,
  ) {}

  async execute(input: PaymentRefundInput): Promise<PaymentRefundResult> {
    const normalized = normalizeInput(input);
    const payment = await this.payments.findById(normalized.paymentId);
    if (!payment) {
      throw new DomainException(
        "PAYMENT_NOT_FOUND",
        `Payment ${normalized.paymentId} was not found.`,
      );
    }
    if (
      payment.orderId !== normalized.orderId ||
      payment.sagaId !== normalized.sagaId
    ) {
      throw new DomainException(
        "PAYMENT_REFUND_IDENTITY_MISMATCH",
        "The refund command does not match the local payment.",
      );
    }
    const idempotencyKey = createRefundIdempotencyKey(payment.id);
    const refundContext = {
      ...normalized,
      idempotencyKey,
    };
    if (
      payment.status !== PaymentStatus.APPROVED &&
      payment.status !== PaymentStatus.REFUNDED
    ) {
      return {
        outcome: "REJECTED",
        payment: await this.payments.rejectRefundRequest(
          refundContext,
          "PAYMENT_NOT_APPROVED",
          new Date(),
        ),
      };
    }
    if (
      payment.status === PaymentStatus.APPROVED &&
      !payment.providerPaymentId
    ) {
      return {
        outcome: "REJECTED",
        payment: await this.payments.rejectRefundRequest(
          refundContext,
          "PROVIDER_PAYMENT_MISSING",
          new Date(),
        ),
      };
    }

    const claim = await this.payments.claimRefund(refundContext);
    if (claim.outcome === "REFUNDED") {
      return { outcome: "REFUNDED", payment: claim.payment };
    }
    if (claim.outcome === "BUSY") {
      throw new DomainException(
        "PAYMENT_REFUND_IN_PROGRESS",
        "The payment refund is already being processed.",
      );
    }

    try {
      const result = await this.provider.refundPayment({
        providerPaymentId: claim.payment.providerPaymentId!,
        idempotencyKey: claim.payment.refundIdempotencyKey!,
      });
      if (result.status !== "COMPLETED") {
        throw new Error("The payment provider returned an incomplete refund.");
      }
      return {
        outcome: "REFUNDED",
        payment: await this.payments.completeRefund(
          claim.payment.id,
          claim.claimToken,
          result.providerRefundId,
          new Date(),
        ),
      };
    } catch (error) {
      await this.payments.releaseRefundClaim(
        claim.payment.id,
        claim.claimToken,
      );
      throw error;
    }
  }
}

export function createRefundIdempotencyKey(paymentId: string): string {
  return createHash("sha256")
    .update(`payment.refund:${paymentId}:REFUNDED`)
    .digest("hex");
}

function normalizeInput(input: PaymentRefundInput): PaymentRefundInput {
  return {
    paymentId: required(input.paymentId, "payment ID"),
    orderId: required(input.orderId, "order ID"),
    sagaId: required(input.sagaId, "saga ID"),
    commandEventId: required(input.commandEventId, "command event ID"),
    correlationId: required(input.correlationId, "correlation ID"),
    reason: sanitizeReason(required(input.reason, "refund reason")),
  };
}

function sanitizeReason(reason: string): string {
  return Array.from(reason)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .slice(0, 256);
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
