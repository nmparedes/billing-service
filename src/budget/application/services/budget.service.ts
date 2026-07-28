import { Inject, Injectable } from "@nestjs/common";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { BUDGET_REPOSITORY } from "../../budget.tokens";
import { Budget } from "../../domain/entities/budget.entity";
import { BudgetStatus } from "../../domain/enums/budget-status.enum";
import type { BudgetRepository } from "../../domain/repositories/budget.repository.interface";
import { BudgetResponseDto } from "../dto/budget-response.dto";
import { CreateBudgetDto } from "../dto/create-budget.dto";
import { RejectBudgetDto } from "../dto/reject-budget.dto";

@Injectable()
export class BudgetService {
  constructor(
    @Inject(BUDGET_REPOSITORY)
    private readonly budgetRepository: BudgetRepository,
  ) {}

  async create(dto: CreateBudgetDto): Promise<BudgetResponseDto> {
    const requestedAt = new Date();
    const expiresAt = new Date(requestedAt);
    expiresAt.setDate(expiresAt.getDate() + (dto.validityDays ?? 7));

    const budget = Budget.request({
      sagaId: dto.sagaId,
      orderId: dto.orderId,
      orderNumber: dto.orderNumber,
      customer: dto.customer,
      vehicle: dto.vehicle,
      serviceItems: dto.serviceItems,
      partItems: dto.partItems,
      requestedAt,
      expiresAt,
    });
    budget.markCreated();
    budget.waitForApproval();

    return this.toResponseDto(
      await this.budgetRepository.createIfAbsent(budget),
    );
  }

  async findById(id: string): Promise<BudgetResponseDto> {
    return this.toResponseDto(await this.getBudget(id));
  }

  async approve(id: string): Promise<BudgetResponseDto> {
    return (await this.approveForPublication(id)).budget;
  }

  async approveForPublication(
    id: string,
  ): Promise<{ budget: BudgetResponseDto; transitioned: boolean }> {
    const budget = await this.getBudget(id);
    if (budget.status === BudgetStatus.APPROVED) {
      return { budget: this.toResponseDto(budget), transitioned: false };
    }
    budget.approve();
    return {
      budget: this.toResponseDto(await this.budgetRepository.save(budget)),
      transitioned: true,
    };
  }

  async reject(id: string, dto: RejectBudgetDto): Promise<BudgetResponseDto> {
    return (await this.rejectForPublication(id, dto)).budget;
  }

  async rejectForPublication(
    id: string,
    dto: RejectBudgetDto,
  ): Promise<{ budget: BudgetResponseDto; transitioned: boolean }> {
    const budget = await this.getBudget(id);
    if (budget.status === BudgetStatus.REJECTED) {
      return { budget: this.toResponseDto(budget), transitioned: false };
    }
    budget.reject(dto.reason);
    return {
      budget: this.toResponseDto(await this.budgetRepository.save(budget)),
      transitioned: true,
    };
  }

  private async getBudget(id: string): Promise<Budget> {
    const budget = await this.budgetRepository.findById(id);
    if (!budget) {
      throw new DomainException(
        "BUDGET_NOT_FOUND",
        `Budget ${id} was not found.`,
      );
    }
    return budget;
  }

  private toResponseDto(budget: Budget): BudgetResponseDto {
    return {
      id: budget.id,
      sagaId: budget.sagaId,
      orderId: budget.orderId,
      orderNumber: budget.orderNumber,
      customerId: budget.customer.customerId,
      customerDocument: budget.customer.customerDocument,
      customerName: budget.customer.customerName,
      vehicleId: budget.vehicle?.vehicleId,
      vehiclePlate: budget.vehicle?.vehiclePlate,
      vehicleBrand: budget.vehicle?.vehicleBrand,
      vehicleModel: budget.vehicle?.vehicleModel,
      vehicleYear: budget.vehicle?.vehicleYear,
      status: budget.status,
      serviceItems: budget.serviceItems,
      partItems: budget.partItems,
      serviceSubtotal: budget.serviceSubtotal,
      partSubtotal: budget.partSubtotal,
      totalAmount: budget.totalAmount,
      requestedAt: budget.requestedAt,
      createdAt: budget.createdAt,
      approvalRequestedAt: budget.approvalRequestedAt,
      approvedAt: budget.approvedAt,
      rejectedAt: budget.rejectedAt,
      expiresAt: budget.expiresAt,
      rejectionReason: budget.rejectionReason,
    };
  }
}
