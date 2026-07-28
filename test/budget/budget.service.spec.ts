import { DomainException } from "../../src/common/exceptions/domain.exception";
import { BudgetService } from "../../src/budget/application/services/budget.service";
import { Budget } from "../../src/budget/domain/entities/budget.entity";
import { BudgetStatus } from "../../src/budget/domain/enums/budget-status.enum";
import type { BudgetRepository } from "../../src/budget/domain/repositories/budget.repository.interface";

describe("BudgetService", () => {
  let repository: jest.Mocked<BudgetRepository>;
  let service: BudgetService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      findBySagaAndOrder: jest.fn(),
      createIfAbsent: jest.fn(async (budget) => budget),
      save: jest.fn(async (budget) => budget),
    };
    service = new BudgetService(repository);
  });

  it("creates a budget waiting for approval with a seven-day default validity", async () => {
    const response = await service.create(createBudgetDto());

    expect(response.status).toBe(BudgetStatus.WAITING_APPROVAL);
    expect(response.serviceSubtotal).toBe(300);
    expect(response.partSubtotal).toBe(100);
    expect(response.totalAmount).toBe(400);
    expect(repository.createIfAbsent).toHaveBeenCalledTimes(1);
  });

  it("returns the stored budget for duplicate saga and order requests", async () => {
    const existing = readyBudget("existing-budget");
    repository.createIfAbsent.mockResolvedValue(existing);

    const response = await service.create(createBudgetDto());

    expect(response.id).toBe("existing-budget");
    expect(repository.createIfAbsent).toHaveBeenCalledTimes(1);
  });

  it("returns a budget and raises a not-found error when absent", async () => {
    repository.findById.mockResolvedValue(readyBudget());
    await expect(service.findById("budget-1")).resolves.toEqual(
      expect.objectContaining({ id: "budget-1" }),
    );

    repository.findById.mockResolvedValue(null);
    await expect(service.findById("missing")).rejects.toMatchObject({
      code: "BUDGET_NOT_FOUND",
    } as DomainException);
  });

  it("approves and rejects budgets through the repository", async () => {
    const approved = readyBudget();
    repository.findById.mockResolvedValueOnce(approved);
    await expect(service.approve(approved.id)).resolves.toMatchObject({
      status: BudgetStatus.APPROVED,
    });

    const rejected = readyBudget("budget-rejected");
    repository.findById.mockResolvedValueOnce(rejected);
    await expect(
      service.reject(rejected.id, { reason: "Customer declined." }),
    ).resolves.toMatchObject({
      status: BudgetStatus.REJECTED,
      rejectionReason: "Customer declined.",
    });
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it("returns already persisted approval and rejection transitions for publication retry", async () => {
    const approved = readyBudget();
    approved.approve();
    repository.findById.mockResolvedValueOnce(approved);

    await expect(service.approveForPublication(approved.id)).resolves.toEqual(
      expect.objectContaining({ transitioned: false }),
    );
    expect(repository.save).not.toHaveBeenCalled();

    const rejected = readyBudget("budget-rejected");
    rejected.reject("Customer declined.");
    repository.findById.mockResolvedValueOnce(rejected);
    await expect(
      service.rejectForPublication(rejected.id, {
        reason: "Customer declined.",
      }),
    ).resolves.toEqual(expect.objectContaining({ transitioned: false }));
  });
});

function createBudgetDto() {
  return {
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
    partItems: [
      {
        partId: "part-1",
        partCode: "BRK-001",
        partName: "Brake pad",
        unitPrice: 50,
        quantity: 2,
      },
    ],
  };
}

function readyBudget(id = "budget-1"): Budget {
  const budget = Budget.request({ id, ...createBudgetDto() });
  budget.markCreated();
  budget.waitForApproval();
  return budget;
}
