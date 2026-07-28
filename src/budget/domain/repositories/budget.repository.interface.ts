import { Budget } from "../entities/budget.entity";

export interface BudgetRepository {
  findById(id: string): Promise<Budget | null>;
  findBySagaAndOrder(sagaId: string, orderId: string): Promise<Budget | null>;
  createIfAbsent(budget: Budget): Promise<Budget>;
  save(budget: Budget): Promise<Budget>;
}
