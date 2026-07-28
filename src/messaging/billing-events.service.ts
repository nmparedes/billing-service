import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BudgetService } from "../budget/application/services/budget.service";
import { PaymentStatus } from "../payment/domain/enums/payment-status.enum";
import type { BudgetResponseDto } from "../budget/application/dto/budget-response.dto";
import type { BudgetRequestedMessage } from "../contracts/order-flow.contracts";
import {
  MESSAGE_CONSUMER,
  MESSAGE_PUBLISHER,
  type BrokerMessage,
  type MessageConsumer,
  type MessagePublisher,
} from "./rabbitmq-broker";
import { MongoConsumedMessageRepository } from "./consumed-message.repository";
import { createDeterministicEventId } from "./deterministic-event-id";
import type {
  BillingEventPublisher,
  PaymentEvent,
} from "../payment/application/ports/billing-event-publisher.interface";

const BUDGET_REQUEST_CONSUMER = "billing-budget-requested";
const BILLING_EXCHANGE = "billing.topic";

@Injectable()
export class BillingEventsService
  implements OnModuleInit, BillingEventPublisher
{
  constructor(
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
    @Inject(MESSAGE_CONSUMER) private readonly consumer: MessageConsumer,
    private readonly budgetService: BudgetService,
    private readonly consumedMessages: MongoConsumedMessageRepository,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.configService.get<boolean>("MESSAGING_ENABLED", false)) return;
    await this.consumer.subscribe("billing.budget.requests", (message) =>
      this.consumeBudgetRequested(message),
    );
  }

  async consumeBudgetRequested(message: BrokerMessage): Promise<void> {
    const input = this.asBudgetRequested(message);
    const claimed = await this.consumedMessages.claim(
      BUDGET_REQUEST_CONSUMER,
      input.eventId,
    );
    if (!claimed) return;

    try {
      const budget = await this.budgetService.create({
        ...input.payload,
        sagaId: input.sagaId,
        orderId: input.orderId,
      });
      await this.publishBudgetCreated(input, budget);
      await this.consumedMessages.markProcessed(
        BUDGET_REQUEST_CONSUMER,
        input.eventId,
        claimed.token,
      );
    } catch (error) {
      await this.consumedMessages.markFailed(
        BUDGET_REQUEST_CONSUMER,
        input.eventId,
        claimed.token,
      );
      throw error;
    }
  }

  async publishBudgetApproved(
    budget: BudgetResponseDto,
    causationId: string,
    correlationId = budget.orderId,
  ): Promise<void> {
    if (!this.messagingEnabled()) return;
    await this.publishBudgetState(
      "budget.approved",
      budget,
      causationId,
      correlationId,
    );
  }

  async publishBudgetRejected(
    budget: BudgetResponseDto,
    causationId: string,
    correlationId = budget.orderId,
  ): Promise<void> {
    if (!this.messagingEnabled()) return;
    await this.publishBudgetState(
      "budget.rejected",
      budget,
      causationId,
      correlationId,
    );
  }

  async publishPaymentCreated(
    payment: PaymentEvent,
    causationId: string,
    correlationId = payment.orderId,
  ): Promise<void> {
    if (!this.messagingEnabled()) return;
    await this.publishPaymentState(
      "payment.created",
      payment,
      causationId,
      correlationId,
    );
  }

  async publishPaymentApproved(
    payment: PaymentEvent,
    causationId: string,
    correlationId = payment.orderId,
  ): Promise<void> {
    if (!this.messagingEnabled()) return;
    await this.publishPaymentState(
      "payment.approved",
      payment,
      causationId,
      correlationId,
    );
  }

  async publishPaymentFailed(
    payment: {
      id: string;
      budgetId: string;
      orderId: string;
      sagaId: string;
      status: PaymentStatus;
      createdAt: Date;
      approvedAt?: Date;
      failedAt?: Date;
      providerPaymentId?: string;
      checkoutUrl?: string;
    },
    causationId: string,
    correlationId = payment.orderId,
  ): Promise<void> {
    if (!this.messagingEnabled()) return;
    await this.publishPaymentState(
      "payment.failed",
      payment,
      causationId,
      correlationId,
    );
  }

  private async publishBudgetCreated(
    message: BudgetRequestedMessage,
    budget: BudgetResponseDto,
  ): Promise<void> {
    await this.publishBudgetState(
      "budget.created",
      budget,
      message.eventId,
      message.correlationId,
    );
  }

  private async publishBudgetState(
    eventName: "budget.created" | "budget.approved" | "budget.rejected",
    budget: BudgetResponseDto,
    causationId: string,
    correlationId: string,
  ): Promise<void> {
    const transition = budgetTransition(eventName);
    await this.publisher.publish(BILLING_EXCHANGE, eventName, {
      eventId: createDeterministicEventId(eventName, budget.id, transition),
      eventName,
      eventVersion: 1,
      occurredAt: budgetTransitionOccurredAt(budget, eventName).toISOString(),
      correlationId,
      causationId,
      sagaId: budget.sagaId,
      orderId: budget.orderId,
      payload: {
        budgetId: budget.id,
        status: transition,
        totalAmount: budget.totalAmount,
        currency: "BRL",
        rejectionReason: budget.rejectionReason,
      },
    });
  }

  private async publishPaymentState(
    eventName: "payment.created" | "payment.approved" | "payment.failed",
    payment: {
      id: string;
      budgetId: string;
      orderId: string;
      sagaId: string;
      status: PaymentStatus;
      createdAt: Date;
      approvedAt?: Date;
      failedAt?: Date;
      providerPaymentId?: string;
      checkoutUrl?: string;
    },
    causationId: string,
    correlationId: string,
  ): Promise<void> {
    const transition = paymentTransition(eventName);
    const isCreation = eventName === "payment.created";
    await this.publisher.publish(BILLING_EXCHANGE, eventName, {
      eventId: createDeterministicEventId(eventName, payment.id, transition),
      eventName,
      eventVersion: 1,
      occurredAt: paymentTransitionOccurredAt(payment, eventName).toISOString(),
      correlationId,
      causationId,
      sagaId: payment.sagaId,
      orderId: payment.orderId,
      payload: {
        paymentId: payment.id,
        budgetId: payment.budgetId,
        status: transition,
        providerPaymentId: isCreation ? undefined : payment.providerPaymentId,
        checkoutUrl: payment.checkoutUrl,
      },
    });
  }

  private asBudgetRequested(message: BrokerMessage): BudgetRequestedMessage {
    if (
      message.eventName !== "budget.requested" ||
      message.eventVersion !== 1 ||
      !message.eventId ||
      !message.orderId ||
      !message.sagaId ||
      !message.correlationId ||
      !message.causationId
    ) {
      throw new Error("Invalid budget.requested message envelope.");
    }
    const payload = message.payload as BudgetRequestedMessage["payload"];
    if (
      !payload?.orderNumber ||
      !payload.customer ||
      !Array.isArray(payload.serviceItems) ||
      !Array.isArray(payload.partItems)
    ) {
      throw new Error("Invalid budget.requested message payload.");
    }
    return message as BudgetRequestedMessage;
  }

  private messagingEnabled(): boolean {
    return this.configService.get<boolean>("MESSAGING_ENABLED", false);
  }
}

function budgetTransition(
  eventName: "budget.created" | "budget.approved" | "budget.rejected",
): "CREATED" | "APPROVED" | "REJECTED" {
  return eventName === "budget.created"
    ? "CREATED"
    : eventName === "budget.approved"
      ? "APPROVED"
      : "REJECTED";
}

function budgetTransitionOccurredAt(
  budget: BudgetResponseDto,
  eventName: "budget.created" | "budget.approved" | "budget.rejected",
): Date {
  const occurredAt =
    eventName === "budget.created"
      ? budget.createdAt
      : eventName === "budget.approved"
        ? budget.approvedAt
        : budget.rejectedAt;
  if (!occurredAt) {
    throw new Error(`Missing persisted timestamp for ${eventName}.`);
  }
  return occurredAt;
}

function paymentTransition(
  eventName: "payment.created" | "payment.approved" | "payment.failed",
): "PENDING" | "APPROVED" | "FAILED" {
  return eventName === "payment.created"
    ? "PENDING"
    : eventName === "payment.approved"
      ? "APPROVED"
      : "FAILED";
}

function paymentTransitionOccurredAt(
  payment: {
    createdAt: Date;
    approvedAt?: Date;
    failedAt?: Date;
  },
  eventName: "payment.created" | "payment.approved" | "payment.failed",
): Date {
  const occurredAt =
    eventName === "payment.created"
      ? payment.createdAt
      : eventName === "payment.approved"
        ? payment.approvedAt
        : payment.failedAt;
  if (!occurredAt) {
    throw new Error(`Missing persisted timestamp for ${eventName}.`);
  }
  return occurredAt;
}
