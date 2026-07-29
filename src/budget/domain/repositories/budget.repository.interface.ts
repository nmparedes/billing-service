import { Budget } from "../entities/budget.entity";
import { BudgetListFilters } from "./budget-list-filters.interface";
import { PaginatedResponse } from "../../../common/interfaces/paginated-response.interface";

export interface BudgetRepository {
  findById(id: string): Promise<Budget | null>;
  findAll(filters: BudgetListFilters): Promise<PaginatedResponse<Budget>>;
  findBySagaAndOrder(sagaId: string, orderId: string): Promise<Budget | null>;
  createIfAbsent(budget: Budget): Promise<Budget>;
  save(budget: Budget): Promise<Budget>;
}
