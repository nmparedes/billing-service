import type {
  BudgetRequestedMessage,
  PaymentApprovedMessage,
  PaymentRefundFailedMessage,
  PaymentRefundRequestedMessage,
  PaymentRefundedMessage,
} from "../../src/contracts/order-flow.contracts";

describe("Order flow contracts", () => {
  it("defines the consumed budget request with local snapshots", () => {
    const message: BudgetRequestedMessage = {
      eventId: "event-001",
      eventName: "budget.requested",
      eventVersion: 1,
      occurredAt: "2026-01-01T00:00:00.000Z",
      correlationId: "correlation-001",
      causationId: "cause-001",
      sagaId: "saga-001",
      orderId: "order-001",
      payload: {
        orderNumber: "OS-001",
        customer: {
          customerId: "customer-001",
          customerDocument: "52998224725",
          customerName: "Customer",
        },
        serviceItems: [],
        partItems: [],
      },
    };

    expect(message.payload.orderNumber).toBe("OS-001");
    expect(message.eventVersion).toBe(1);
  });

  it("defines the published payment approval event", () => {
    const message: PaymentApprovedMessage = {
      eventId: "event-002",
      eventName: "payment.approved",
      eventVersion: 1,
      occurredAt: "2026-01-01T00:00:00.000Z",
      correlationId: "correlation-001",
      causationId: "event-001",
      sagaId: "saga-001",
      orderId: "order-001",
      payload: {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "APPROVED",
        providerPaymentId: "provider-001",
      },
    };

    expect(message.payload.status).toBe("APPROVED");
  });

  it("keeps refund command and outcome payloads structurally compatible with OS", () => {
    const request: PaymentRefundRequestedMessage = {
      eventId: "event-003",
      eventName: "payment.refund.requested",
      eventVersion: 1,
      occurredAt: "2026-01-01T00:00:00.000Z",
      correlationId: "correlation-001",
      causationId: "event-002",
      sagaId: "saga-001",
      orderId: "order-001",
      payload: { paymentId: "payment-001", reason: "EXECUTION_FAILED" },
    };
    const refunded: PaymentRefundedMessage = {
      ...request,
      eventId: "event-004",
      eventName: "payment.refunded",
      payload: {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "REFUNDED",
        providerPaymentId: "provider-payment-001",
        providerRefundId: "provider-refund-001",
      },
    };
    const failed: PaymentRefundFailedMessage = {
      ...request,
      eventId: "event-005",
      eventName: "payment.refund.failed",
      payload: {
        paymentId: "payment-001",
        budgetId: "budget-001",
        status: "REFUND_FAILED",
        failureCode: "PROVIDER_UNAVAILABLE",
      },
    };

    expect(request.payload.paymentId).toBe(refunded.payload.paymentId);
    expect(refunded.payload.status).toBe("REFUNDED");
    expect(failed.payload.status).toBe("REFUND_FAILED");
  });
});
