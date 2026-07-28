import { DomainException } from "../../src/common/exceptions/domain.exception";
import { Budget } from "../../src/budget/domain/entities/budget.entity";
import { BudgetStatus } from "../../src/budget/domain/enums/budget-status.enum";

describe("Budget", () => {
  it("calculates service, part and total amounts from immutable snapshots", () => {
    const budget = createBudget();

    expect(budget.status).toBe(BudgetStatus.REQUESTED);
    expect(budget.serviceItems[0].subtotal).toBe(300);
    expect(budget.partItems[0].subtotal).toBe(100);
    expect(budget.serviceSubtotal).toBe(300);
    expect(budget.partSubtotal).toBe(100);
    expect(budget.totalAmount).toBe(400);
  });

  it("follows the requested, created and waiting approval lifecycle", () => {
    const budget = createBudget();
    budget.markCreated();
    budget.waitForApproval();

    expect(budget.status).toBe(BudgetStatus.WAITING_APPROVAL);
    expect(budget.createdAt).toBeInstanceOf(Date);
    expect(budget.approvalRequestedAt).toBeInstanceOf(Date);
  });

  it("approves and rejects only budgets waiting for approval", () => {
    const approved = readyBudget();
    approved.approve();
    expect(approved.status).toBe(BudgetStatus.APPROVED);

    const rejected = readyBudget();
    rejected.reject("Customer declined the amount.");
    expect(rejected.status).toBe(BudgetStatus.REJECTED);
    expect(rejected.rejectionReason).toBe("Customer declined the amount.");
  });

  it("rejects invalid transitions and budgets without items", () => {
    expect(() => createBudget({ serviceItems: [], partItems: [] })).toThrow(
      DomainException,
    );
    expect(() => createBudget().approve()).toThrow(DomainException);
  });

  it("expires budgets only after their expiration date", () => {
    const budget = readyBudget();

    expect(() => budget.expire(new Date("2099-01-02T00:00:00.000Z"))).toThrow(
      "cannot expire",
    );
    budget.expire(new Date("2099-01-08T00:00:00.000Z"));
    expect(budget.status).toBe(BudgetStatus.EXPIRED);
  });
});

function readyBudget(): Budget {
  const budget = createBudget();
  budget.markCreated();
  budget.waitForApproval();
  return budget;
}

function createBudget(
  overrides: Partial<Parameters<typeof Budget.request>[0]> = {},
): Budget {
  return Budget.request({
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
    requestedAt: new Date("2099-01-01T00:00:00.000Z"),
    ...overrides,
  });
}
