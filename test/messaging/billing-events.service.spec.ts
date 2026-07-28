import { BudgetService } from "../../src/budget/application/services/budget.service";
import { BillingEventsService } from "../../src/messaging/billing-events.service";
import { MongoConsumedMessageRepository } from "../../src/messaging/consumed-message.repository";

describe("BillingEventsService", () => {
  const publisher = { publish: jest.fn() };
  const consumer = { subscribe: jest.fn() };
  const budgetService = {
    create: jest.fn(),
  } as unknown as jest.Mocked<BudgetService>;
  const consumedMessages = {
    claim: jest.fn(),
    markProcessed: jest.fn(),
    markFailed: jest.fn(),
  } as unknown as jest.Mocked<MongoConsumedMessageRepository>;
  const service = new BillingEventsService(
    publisher,
    consumer,
    budgetService,
    consumedMessages,
    { get: jest.fn().mockReturnValue(false) } as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it("creates a budget once and publishes budget.created with propagated identifiers", async () => {
    consumedMessages.claim.mockResolvedValue({ token: "claim-1" });
    budgetService.create.mockResolvedValue(budget() as never);

    await service.consumeBudgetRequested(request());

    expect(budgetService.create).toHaveBeenCalledWith(
      expect.objectContaining({ sagaId: "saga-1", orderId: "order-1" }),
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      "billing.topic",
      "budget.created",
      expect.objectContaining({
        correlationId: "correlation-1",
        causationId: "event-1",
        sagaId: "saga-1",
        orderId: "order-1",
      }),
    );
    expect(consumedMessages.markProcessed).toHaveBeenCalledWith(
      "billing-budget-requested",
      "event-1",
      "claim-1",
    );
  });

  it("does not repeat a completed event and marks failures for retry", async () => {
    consumedMessages.claim.mockResolvedValue(null);
    await service.consumeBudgetRequested(request());
    expect(budgetService.create).not.toHaveBeenCalled();

    consumedMessages.claim.mockResolvedValue({ token: "claim-2" });
    publisher.publish.mockRejectedValueOnce(new Error("broker unavailable"));
    budgetService.create.mockResolvedValue(budget() as never);
    await expect(service.consumeBudgetRequested(request())).rejects.toThrow(
      "broker unavailable",
    );
    expect(consumedMessages.markFailed).toHaveBeenCalledWith(
      "billing-budget-requested",
      "event-1",
      "claim-2",
    );
  });

  it("uses a stable event ID and does not contact RabbitMQ when disabled", async () => {
    await service.publishBudgetApproved(
      { ...budget(), status: "APPROVED" } as never,
      "budget-1",
    );
    expect(publisher.publish).not.toHaveBeenCalled();

    const enabledService = new BillingEventsService(
      publisher,
      consumer,
      budgetService,
      consumedMessages,
      { get: jest.fn().mockReturnValue(true) } as never,
    );
    await enabledService.publishBudgetApproved(
      { ...budget(), status: "APPROVED" } as never,
      "budget-1",
    );
    const firstEventId = publisher.publish.mock.calls[0][2].eventId;
    await enabledService.publishBudgetApproved(
      { ...budget(), status: "APPROVED" } as never,
      "budget-1",
    );
    expect(publisher.publish.mock.calls[1][2].eventId).toBe(firstEventId);
  });

  it("re-publishes an immutable payment.created snapshot after payment approval", async () => {
    const enabledService = new BillingEventsService(
      publisher,
      consumer,
      budgetService,
      consumedMessages,
      { get: jest.fn().mockReturnValue(true) } as never,
    );
    const createdPayment = payment();

    await enabledService.publishPaymentCreated(createdPayment, "budget-1");
    await enabledService.publishPaymentCreated(
      {
        ...createdPayment,
        status: "APPROVED" as never,
        approvedAt: new Date("2026-01-02T00:00:00.000Z"),
        providerPaymentId: "provider-payment-1",
      },
      "budget-1",
    );

    const firstEnvelope = publisher.publish.mock.calls[0][2];
    const retryEnvelope = publisher.publish.mock.calls[1][2];
    expect(firstEnvelope).toEqual(retryEnvelope);
    expect(firstEnvelope).toMatchObject({
      eventName: "payment.created",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: {
        paymentId: "payment-1",
        budgetId: "budget-1",
        status: "PENDING",
        checkoutUrl: "https://checkout.example.test/payment-1",
        providerPaymentId: undefined,
      },
    });
  });

  it("uses persisted business transitions for budget and payment event identities", async () => {
    const enabledService = new BillingEventsService(
      publisher,
      consumer,
      budgetService,
      consumedMessages,
      { get: jest.fn().mockReturnValue(true) } as never,
    );
    await enabledService.publishBudgetApproved(
      { ...budget(), status: "APPROVED" } as never,
      "notification-1",
    );
    await enabledService.publishBudgetApproved(
      { ...budget(), status: "APPROVED" } as never,
      "notification-2",
    );
    await enabledService.publishBudgetRejected(
      { ...budget(), status: "REJECTED" } as never,
      "budget-1",
    );
    await enabledService.publishPaymentFailed(
      { ...payment(), status: "FAILED" as never },
      "notification-1",
    );
    await enabledService.publishPaymentFailed(
      { ...payment(), status: "FAILED" as never },
      "notification-2",
    );

    expect(publisher.publish.mock.calls[0][2].eventId).toBe(
      publisher.publish.mock.calls[1][2].eventId,
    );
    expect(publisher.publish.mock.calls[0][2].occurredAt).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    expect(publisher.publish.mock.calls[3][2].eventId).toBe(
      publisher.publish.mock.calls[4][2].eventId,
    );
    expect(publisher.publish.mock.calls[3][2].occurredAt).toBe(
      "2026-01-03T00:00:00.000Z",
    );
  });

  it("re-publishes a confirmed budget result when claim completion fails", async () => {
    const enabledService = new BillingEventsService(
      publisher,
      consumer,
      budgetService,
      consumedMessages,
      { get: jest.fn().mockReturnValue(true) } as never,
    );
    consumedMessages.claim
      .mockResolvedValueOnce({ token: "claim-1" })
      .mockResolvedValueOnce({ token: "claim-2" });
    budgetService.create.mockResolvedValue(budget() as never);
    consumedMessages.markProcessed.mockRejectedValueOnce(
      new Error("claim completion failed"),
    );

    await expect(
      enabledService.consumeBudgetRequested(request()),
    ).rejects.toThrow("claim completion failed");
    const firstEventId = publisher.publish.mock.calls[0][2].eventId;

    await enabledService.consumeBudgetRequested(request());
    expect(publisher.publish.mock.calls[1][2].eventId).toBe(firstEventId);
  });
});

function request() {
  return {
    eventId: "event-1",
    eventName: "budget.requested",
    eventVersion: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    correlationId: "correlation-1",
    causationId: "cause-1",
    sagaId: "saga-1",
    orderId: "order-1",
    payload: {
      orderNumber: "OS-1",
      customer: {
        customerId: "customer-1",
        customerDocument: "123",
        customerName: "Customer",
      },
      serviceItems: [
        {
          serviceId: "service-1",
          serviceName: "Repair",
          unitPrice: 10,
          quantity: 1,
        },
      ],
      partItems: [],
    },
  };
}

function budget() {
  return {
    id: "budget-1",
    sagaId: "saga-1",
    orderId: "order-1",
    status: "WAITING_APPROVAL",
    totalAmount: 10,
    rejectionReason: undefined,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    approvedAt: new Date("2026-01-02T00:00:00.000Z"),
    rejectedAt: new Date("2026-01-03T00:00:00.000Z"),
  };
}

function payment() {
  return {
    id: "payment-1",
    budgetId: "budget-1",
    orderId: "order-1",
    sagaId: "saga-1",
    status: "PENDING" as never,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    approvedAt: new Date("2026-01-02T00:00:00.000Z"),
    failedAt: new Date("2026-01-03T00:00:00.000Z"),
    checkoutUrl: "https://checkout.example.test/payment-1",
  };
}
