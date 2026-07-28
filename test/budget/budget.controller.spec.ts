import { BudgetController } from "../../src/budget/infrastructure/controllers/budget.controller";
import { BudgetService } from "../../src/budget/application/services/budget.service";
import { BillingEventsService } from "../../src/messaging/billing-events.service";

describe("BudgetController", () => {
  const budgetService = {
    create: jest.fn(),
    findById: jest.fn(),
    approveForPublication: jest.fn(),
    rejectForPublication: jest.fn(),
  } as unknown as jest.Mocked<BudgetService>;
  const billingEvents = {
    publishBudgetApproved: jest.fn(),
    publishBudgetRejected: jest.fn(),
  } as unknown as jest.Mocked<BillingEventsService>;
  const controller = new BudgetController(budgetService, billingEvents);

  beforeEach(() => jest.clearAllMocks());

  it("delegates budget endpoints to the application service", async () => {
    const response = { id: "budget-1" };
    budgetService.create.mockResolvedValue(response as never);
    budgetService.findById.mockResolvedValue(response as never);
    budgetService.approveForPublication.mockResolvedValue({
      budget: response,
      transitioned: true,
    } as never);
    budgetService.rejectForPublication.mockResolvedValue({
      budget: response,
      transitioned: true,
    } as never);

    const create = { sagaId: "saga-1", orderId: "order-1" } as never;
    const reject = { reason: "Customer declined." };

    await expect(controller.create(create)).resolves.toEqual(response);
    await expect(controller.findById("budget-1")).resolves.toEqual(response);
    await expect(controller.approve("budget-1")).resolves.toEqual(response);
    await expect(controller.reject("budget-1", reject)).resolves.toEqual(
      response,
    );

    expect(budgetService.create).toHaveBeenCalledWith(create);
    expect(budgetService.findById).toHaveBeenCalledWith("budget-1");
    expect(budgetService.approveForPublication).toHaveBeenCalledWith(
      "budget-1",
    );
    expect(budgetService.rejectForPublication).toHaveBeenCalledWith(
      "budget-1",
      reject,
    );
    expect(billingEvents.publishBudgetApproved).toHaveBeenCalledWith(
      response,
      "budget-1",
    );
    expect(billingEvents.publishBudgetRejected).toHaveBeenCalledWith(
      response,
      "budget-1",
    );
  });
});
