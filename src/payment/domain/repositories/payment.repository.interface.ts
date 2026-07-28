import { Payment } from "../entities/payment.entity";

export interface RefundClaimInput {
  paymentId: string;
  orderId: string;
  sagaId: string;
  commandEventId: string;
  correlationId: string;
  idempotencyKey: string;
  reason: string;
}

export type RefundClaimResult =
  | { outcome: "CLAIMED"; payment: Payment; claimToken: string }
  | { outcome: "BUSY"; payment: Payment }
  | { outcome: "REFUNDED"; payment: Payment };

export interface PaymentRepository {
  findById(id: string): Promise<Payment | null>;
  findByBudgetId(budgetId: string): Promise<Payment | null>;
  findByExternalReference(externalReference: string): Promise<Payment | null>;
  createIfAbsent(payment: Payment): Promise<Payment>;
  tryClaimPreferenceCreation(paymentId: string): Promise<boolean>;
  releasePreferenceCreation(paymentId: string): Promise<void>;
  save(payment: Payment): Promise<Payment>;
  claimRefund(input: RefundClaimInput): Promise<RefundClaimResult>;
  completeRefund(
    paymentId: string,
    claimToken: string,
    providerRefundId: string,
    refundedAt: Date,
  ): Promise<Payment>;
  releaseRefundClaim(paymentId: string, claimToken: string): Promise<boolean>;
  rejectRefund(
    paymentId: string,
    claimToken: string,
    failureCode: string,
    failedAt: Date,
  ): Promise<Payment>;
  rejectRefundRequest(
    input: RefundClaimInput,
    failureCode: string,
    failedAt: Date,
  ): Promise<Payment>;
}
