import { MongoClient } from "mongodb";
import { Budget } from "../../src/budget/domain/entities/budget.entity";
import { MongoBudgetRepository } from "../../src/budget/infrastructure/repositories/mongo-budget.repository";

describe("MongoBudgetRepository", () => {
  it("uses the budgets collection and compound saga/order identity", async () => {
    const budget = readyBudget();
    const document = {
      _id: budget.id,
      sagaId: budget.sagaId,
      orderId: budget.orderId,
      orderNumber: budget.orderNumber,
      customer: budget.customer,
      vehicle: budget.vehicle,
      serviceItems: budget.serviceItems,
      partItems: budget.partItems,
      serviceSubtotal: budget.serviceSubtotal,
      partSubtotal: budget.partSubtotal,
      totalAmount: budget.totalAmount,
      status: budget.status,
      requestedAt: budget.requestedAt,
      createdAt: budget.createdAt,
      approvalRequestedAt: budget.approvalRequestedAt,
      expiresAt: budget.expiresAt,
      updatedAt: budget.updatedAt,
    };
    const collection = {
      createIndex: jest.fn().mockResolvedValue("budget_saga_order_unique"),
      findOne: jest.fn().mockResolvedValue(document),
      findOneAndUpdate: jest.fn().mockResolvedValue(document),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    const client = {
      db: jest
        .fn()
        .mockReturnValue({ collection: jest.fn().mockReturnValue(collection) }),
    } as unknown as MongoClient;
    const repository = new MongoBudgetRepository(client);

    await expect(repository.findById(budget.id)).resolves.toMatchObject({
      id: budget.id,
    });
    await expect(
      repository.findBySagaAndOrder(budget.sagaId, budget.orderId),
    ).resolves.toMatchObject({ id: budget.id });
    await expect(repository.createIfAbsent(budget)).resolves.toMatchObject({
      id: budget.id,
    });
    await expect(repository.save(budget)).resolves.toBe(budget);

    expect(collection.createIndex).toHaveBeenCalledWith(
      { sagaId: 1, orderId: 1 },
      { unique: true, name: "budget_saga_order_unique" },
    );
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { sagaId: budget.sagaId, orderId: budget.orderId },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ _id: budget.id }),
      }),
      { upsert: true, returnDocument: "after" },
    );
  });
});

function readyBudget(): Budget {
  const budget = Budget.request({
    id: "budget-1",
    sagaId: "saga-1",
    orderId: "order-1",
    orderNumber: "OS-20260118-0001",
    customer: {
      customerId: "customer-1",
      customerDocument: "52998224725",
      customerName: "Maria Silva",
    },
    serviceItems: [
      {
        serviceId: "service-1",
        serviceName: "Alignment",
        unitPrice: 150,
        quantity: 2,
      },
    ],
    partItems: [],
  });
  budget.markCreated();
  budget.waitForApproval();
  return budget;
}
