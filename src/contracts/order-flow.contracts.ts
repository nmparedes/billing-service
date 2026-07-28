import type { OrderFlowMessageEnvelope } from "./order-flow-message.interface";

export interface BudgetRequestPayload {
  orderNumber: string;
  customer: {
    customerId: string;
    customerDocument: string;
    customerName: string;
  };
  vehicle?: {
    vehicleId: string;
    vehiclePlate: string;
    vehicleBrand: string;
    vehicleModel: string;
    vehicleYear: number;
  };
  serviceItems: Array<{
    serviceId: string;
    serviceName: string;
    unitPrice: number;
    quantity: number;
  }>;
  partItems: Array<{
    partId: string;
    partCode: string;
    partName: string;
    unitPrice: number;
    quantity: number;
  }>;
  validityDays?: number;
}

export interface BudgetStatePayload {
  budgetId: string;
  status: "CREATED" | "APPROVED" | "REJECTED";
  totalAmount: number;
  currency: "BRL";
  rejectionReason?: string;
}

export interface PaymentStatePayload {
  paymentId: string;
  budgetId: string;
  status: "PENDING" | "APPROVED" | "FAILED";
  providerPaymentId?: string;
  checkoutUrl?: string;
}

export interface PaymentRefundRequestPayload {
  paymentId: string;
  reason: string;
}

export interface PaymentRefundedPayload {
  paymentId: string;
  budgetId: string;
  status: "REFUNDED";
  providerPaymentId?: string;
  providerRefundId?: string;
}

export interface PaymentRefundFailedPayload {
  paymentId: string;
  budgetId: string;
  status: "REFUND_FAILED";
  providerPaymentId?: string;
  failureCode: string;
}

export type BudgetRequestedMessage = OrderFlowMessageEnvelope<
  "budget.requested",
  BudgetRequestPayload
>;
export type PaymentRefundRequestedMessage = OrderFlowMessageEnvelope<
  "payment.refund.requested",
  PaymentRefundRequestPayload
>;
export type BudgetCreatedMessage = OrderFlowMessageEnvelope<
  "budget.created",
  BudgetStatePayload
>;
export type BudgetApprovedMessage = OrderFlowMessageEnvelope<
  "budget.approved",
  BudgetStatePayload
>;
export type BudgetRejectedMessage = OrderFlowMessageEnvelope<
  "budget.rejected",
  BudgetStatePayload
>;
export type PaymentCreatedMessage = OrderFlowMessageEnvelope<
  "payment.created",
  PaymentStatePayload
>;
export type PaymentApprovedMessage = OrderFlowMessageEnvelope<
  "payment.approved",
  PaymentStatePayload
>;
export type PaymentFailedMessage = OrderFlowMessageEnvelope<
  "payment.failed",
  PaymentStatePayload
>;
export type PaymentRefundedMessage = OrderFlowMessageEnvelope<
  "payment.refunded",
  PaymentRefundedPayload
>;
export type PaymentRefundFailedMessage = OrderFlowMessageEnvelope<
  "payment.refund.failed",
  PaymentRefundFailedPayload
>;
