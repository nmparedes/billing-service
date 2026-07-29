import { BudgetStatus } from "../enums/budget-status.enum";

export interface BudgetListFilters {
  orderId?: string;
  orderNumber?: string;
  status?: BudgetStatus;
  customerDocument?: string;
  page: number;
  limit: number;
}
