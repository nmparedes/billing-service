import { randomUUID } from "crypto";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { BudgetStatus } from "../enums/budget-status.enum";

export interface BudgetServiceItemSnapshot {
  serviceId: string;
  serviceName: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface BudgetPartItemSnapshot {
  partId: string;
  partCode: string;
  partName: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface BudgetCustomerSnapshot {
  customerId: string;
  customerDocument: string;
  customerName: string;
}

export interface BudgetVehicleSnapshot {
  vehicleId: string;
  vehiclePlate: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number;
}

export interface RequestBudgetProps {
  id?: string;
  sagaId: string;
  orderId: string;
  orderNumber: string;
  customer: BudgetCustomerSnapshot;
  vehicle?: BudgetVehicleSnapshot;
  serviceItems: Array<Omit<BudgetServiceItemSnapshot, "subtotal">>;
  partItems: Array<Omit<BudgetPartItemSnapshot, "subtotal">>;
  requestedAt?: Date;
  expiresAt?: Date;
}

export interface RestoreBudgetProps {
  id: string;
  sagaId: string;
  orderId: string;
  orderNumber: string;
  customer: BudgetCustomerSnapshot;
  vehicle?: BudgetVehicleSnapshot;
  serviceItems: BudgetServiceItemSnapshot[];
  partItems: BudgetPartItemSnapshot[];
  serviceSubtotal: number;
  partSubtotal: number;
  totalAmount: number;
  status: BudgetStatus;
  rejectionReason?: string;
  requestedAt: Date;
  createdAt?: Date;
  approvalRequestedAt?: Date;
  approvedAt?: Date;
  rejectedAt?: Date;
  expiresAt: Date;
  updatedAt?: Date;
}

export class Budget {
  private constructor(private readonly props: RestoreBudgetProps) {}

  static request(props: RequestBudgetProps): Budget {
    if (props.serviceItems.length === 0 && props.partItems.length === 0) {
      throw new DomainException(
        "BUDGET_WITHOUT_ITEMS",
        "A budget requires at least one service or part item.",
      );
    }

    const requestedAt = props.requestedAt ?? new Date();
    const serviceItems = props.serviceItems.map((item) => ({
      ...item,
      subtotal: item.unitPrice * item.quantity,
    }));
    const partItems = props.partItems.map((item) => ({
      ...item,
      subtotal: item.unitPrice * item.quantity,
    }));
    const serviceSubtotal = serviceItems.reduce(
      (total, item) => total + item.subtotal,
      0,
    );
    const partSubtotal = partItems.reduce(
      (total, item) => total + item.subtotal,
      0,
    );

    return new Budget({
      id: props.id ?? randomUUID(),
      sagaId: props.sagaId,
      orderId: props.orderId,
      orderNumber: props.orderNumber,
      customer: props.customer,
      vehicle: props.vehicle,
      serviceItems,
      partItems,
      serviceSubtotal,
      partSubtotal,
      totalAmount: serviceSubtotal + partSubtotal,
      status: BudgetStatus.REQUESTED,
      requestedAt,
      createdAt: undefined,
      expiresAt: props.expiresAt ?? addDays(requestedAt, 7),
      updatedAt: requestedAt,
    });
  }

  static restore(props: RestoreBudgetProps): Budget {
    return new Budget(props);
  }

  markCreated(): void {
    this.assertStatus(BudgetStatus.REQUESTED);
    this.props.status = BudgetStatus.CREATED;
    this.props.createdAt = new Date();
    this.touch();
  }

  waitForApproval(): void {
    this.assertStatus(BudgetStatus.CREATED);
    this.props.status = BudgetStatus.WAITING_APPROVAL;
    this.props.approvalRequestedAt = new Date();
    this.touch();
  }

  approve(): void {
    this.assertApprovable();
    this.props.status = BudgetStatus.APPROVED;
    this.props.approvedAt = new Date();
    this.touch();
  }

  reject(reason?: string): void {
    this.assertApprovable();
    this.props.status = BudgetStatus.REJECTED;
    this.props.rejectionReason = reason?.trim() || undefined;
    this.props.rejectedAt = new Date();
    this.touch();
  }

  expire(now = new Date()): void {
    this.assertStatus(BudgetStatus.WAITING_APPROVAL);
    if (now < this.props.expiresAt) {
      throw new DomainException(
        "BUDGET_NOT_EXPIRED",
        "A budget cannot expire before its expiration date.",
      );
    }
    this.props.status = BudgetStatus.EXPIRED;
    this.touch();
  }

  private assertApprovable(): void {
    this.assertStatus(BudgetStatus.WAITING_APPROVAL);
    if (new Date() >= this.props.expiresAt) {
      throw new DomainException("BUDGET_EXPIRED", "The budget has expired.");
    }
  }

  private assertStatus(expected: BudgetStatus): void {
    if (this.props.status !== expected) {
      throw new DomainException(
        "BUDGET_INVALID_STATUS_TRANSITION",
        `Budget status ${this.props.status} cannot transition from this operation.`,
      );
    }
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }

  get id(): string {
    return this.props.id;
  }
  get sagaId(): string {
    return this.props.sagaId;
  }
  get orderId(): string {
    return this.props.orderId;
  }
  get orderNumber(): string {
    return this.props.orderNumber;
  }
  get customer(): BudgetCustomerSnapshot {
    return this.props.customer;
  }
  get vehicle(): BudgetVehicleSnapshot | undefined {
    return this.props.vehicle;
  }
  get serviceItems(): BudgetServiceItemSnapshot[] {
    return this.props.serviceItems;
  }
  get partItems(): BudgetPartItemSnapshot[] {
    return this.props.partItems;
  }
  get serviceSubtotal(): number {
    return this.props.serviceSubtotal;
  }
  get partSubtotal(): number {
    return this.props.partSubtotal;
  }
  get totalAmount(): number {
    return this.props.totalAmount;
  }
  get status(): BudgetStatus {
    return this.props.status;
  }
  get rejectionReason(): string | undefined {
    return this.props.rejectionReason;
  }
  get requestedAt(): Date {
    return this.props.requestedAt;
  }
  get createdAt(): Date | undefined {
    return this.props.createdAt;
  }
  get approvalRequestedAt(): Date | undefined {
    return this.props.approvalRequestedAt;
  }
  get approvedAt(): Date | undefined {
    return this.props.approvedAt;
  }
  get rejectedAt(): Date | undefined {
    return this.props.rejectedAt;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get updatedAt(): Date | undefined {
    return this.props.updatedAt;
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
