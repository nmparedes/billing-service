import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DomainException } from "../../../common/exceptions/domain.exception";
import { BUDGET_REPOSITORY } from "../../../budget/budget.tokens";
import { BudgetStatus } from "../../../budget/domain/enums/budget-status.enum";
import type { BudgetRepository } from "../../../budget/domain/repositories/budget.repository.interface";
import { PAYMENT_PROVIDER, PAYMENT_REPOSITORY } from "../../payment.tokens";
import { Payment } from "../../domain/entities/payment.entity";
import type { PaymentProvider } from "../../domain/providers/payment-provider.interface";
import type { PaymentRepository } from "../../domain/repositories/payment.repository.interface";
import { CreatePaymentDto } from "../dto/create-payment.dto";
import { PaymentResponseDto } from "../dto/payment-response.dto";

@Injectable()
export class PaymentService {
  constructor(
    @Inject(BUDGET_REPOSITORY)
    private readonly budgetRepository: BudgetRepository,
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: PaymentRepository,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreatePaymentDto): Promise<PaymentResponseDto> {
    return (await this.createWithResult(dto)).payment;
  }

  async createWithResult(
    dto: CreatePaymentDto,
  ): Promise<{ payment: PaymentResponseDto; created: boolean }> {
    const budget = await this.budgetRepository.findById(dto.budgetId);
    if (!budget) {
      throw new DomainException(
        "BUDGET_NOT_FOUND",
        `Budget ${dto.budgetId} was not found.`,
      );
    }
    if (budget.status !== BudgetStatus.APPROVED) {
      throw new DomainException(
        "BUDGET_NOT_APPROVED",
        `Budget ${budget.id} must be approved before payment creation.`,
      );
    }

    const existingPayment = await this.paymentRepository.findByBudgetId(
      budget.id,
    );
    const payment = await this.paymentRepository.createIfAbsent(
      Payment.create({
        budgetId: budget.id,
        orderId: budget.orderId,
        sagaId: budget.sagaId,
        amount: budget.totalAmount,
      }),
    );

    if (payment.providerPreferenceId) {
      return {
        payment: this.toResponseDto(payment),
        created: !existingPayment?.providerPreferenceId,
      };
    }

    const claimed = await this.paymentRepository.tryClaimPreferenceCreation(
      payment.id,
    );
    if (!claimed) {
      const current = await this.paymentRepository.findById(payment.id);
      if (current?.providerPreferenceId) {
        return {
          payment: this.toResponseDto(current),
          created: !existingPayment?.providerPreferenceId,
        };
      }
      throw new DomainException(
        "PAYMENT_CREATION_IN_PROGRESS",
        `Payment ${payment.id} is already creating a checkout preference.`,
      );
    }

    try {
      const preference = await this.paymentProvider.createPreference({
        externalReference: payment.externalReference,
        title: `Service order ${budget.orderNumber}`,
        amount: payment.amount,
        currency: payment.currency,
        notificationUrl: this.configService.getOrThrow<string>(
          "MERCADO_PAGO_NOTIFICATION_URL",
        ),
        backUrls: {
          success: this.configService.getOrThrow<string>(
            "MERCADO_PAGO_SUCCESS_URL",
          ),
          failure: this.configService.getOrThrow<string>(
            "MERCADO_PAGO_FAILURE_URL",
          ),
          pending: this.configService.getOrThrow<string>(
            "MERCADO_PAGO_PENDING_URL",
          ),
        },
      });
      payment.assignPreference(
        preference.providerPreferenceId,
        preference.checkoutUrl,
      );
      return {
        payment: this.toResponseDto(await this.paymentRepository.save(payment)),
        created: true,
      };
    } catch (error: unknown) {
      await this.paymentRepository.releasePreferenceCreation(payment.id);
      if (error instanceof DomainException) {
        throw error;
      }
      throw new DomainException(
        "PAYMENT_PROVIDER_ERROR",
        "The payment provider could not create a checkout preference.",
      );
    }
  }

  async findById(id: string): Promise<PaymentResponseDto> {
    const payment = await this.paymentRepository.findById(id);
    if (!payment) {
      throw new DomainException(
        "PAYMENT_NOT_FOUND",
        `Payment ${id} was not found.`,
      );
    }
    return this.toResponseDto(payment);
  }

  private toResponseDto(payment: Payment): PaymentResponseDto {
    return {
      id: payment.id,
      budgetId: payment.budgetId,
      orderId: payment.orderId,
      sagaId: payment.sagaId,
      externalReference: payment.externalReference,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      providerPreferenceId: payment.providerPreferenceId,
      providerPaymentId: payment.providerPaymentId,
      providerStatus: payment.providerStatus,
      checkoutUrl: payment.checkoutUrl,
      createdAt: payment.createdAt,
      approvedAt: payment.approvedAt,
      failedAt: payment.failedAt,
      updatedAt: payment.updatedAt,
    };
  }
}
