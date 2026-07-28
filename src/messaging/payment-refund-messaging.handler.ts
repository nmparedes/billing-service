import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  PaymentRefundFailedMessage,
  PaymentRefundRequestedMessage,
  PaymentRefundedMessage,
} from "../contracts/order-flow.contracts";
import {
  PaymentRefundService,
  type PaymentRefundResult,
} from "../payment/application/services/payment-refund.service";
import type { Payment } from "../payment/domain/entities/payment.entity";
import { createDeterministicEventId } from "./deterministic-event-id";
import { MongoConsumedMessageRepository } from "./consumed-message.repository";
import {
  MESSAGE_CONSUMER,
  MESSAGE_PUBLISHER,
  type BrokerMessage,
  type MessageConsumer,
  type MessagePublisher,
} from "./rabbitmq-broker";

const REFUND_QUEUE = "billing.payment.compensation.requests";
const REFUND_CONSUMER = "billing-payment-refund-requested";
const BILLING_EXCHANGE = "billing.topic";

@Injectable()
export class PaymentRefundMessagingHandler implements OnModuleInit {
  constructor(
    private readonly refundService: PaymentRefundService,
    @Inject(MESSAGE_CONSUMER) private readonly consumer: MessageConsumer,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
    private readonly consumedMessages: MongoConsumedMessageRepository,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get<boolean>("MESSAGING_ENABLED", false)) return;
    await this.consumer.subscribe(REFUND_QUEUE, (message) =>
      this.handle(message),
    );
  }

  async handle(message: BrokerMessage): Promise<void> {
    const request = validateRefundRequest(message);
    const claim = await this.consumedMessages.claim(
      REFUND_CONSUMER,
      request.eventId,
    );
    if (!claim) return;

    try {
      const result = await this.refundService.execute({
        paymentId: request.payload.paymentId,
        orderId: request.orderId,
        sagaId: request.sagaId,
        commandEventId: request.eventId,
        correlationId: request.correlationId,
        reason: request.payload.reason,
      });
      await this.publishResult(result);
      await this.consumedMessages.markProcessed(
        REFUND_CONSUMER,
        request.eventId,
        claim.token,
      );
    } catch (error) {
      await this.consumedMessages
        .markFailed(REFUND_CONSUMER, request.eventId, claim.token)
        .catch(() => undefined);
      throw error;
    }
  }

  private async publishResult(result: PaymentRefundResult): Promise<void> {
    if (result.outcome === "REFUNDED") {
      await this.publisher.publish(
        BILLING_EXCHANGE,
        "payment.refunded",
        refundedEvent(result.payment),
      );
      return;
    }
    await this.publisher.publish(
      BILLING_EXCHANGE,
      "payment.refund.failed",
      refundFailedEvent(result.payment),
    );
  }
}

function validateRefundRequest(
  message: BrokerMessage,
): PaymentRefundRequestedMessage {
  if (
    normalized(message.eventName) !== "payment.refund.requested" ||
    message.eventVersion !== 1 ||
    !normalized(message.eventId) ||
    !validIsoTimestamp(message.occurredAt) ||
    !normalized(message.correlationId) ||
    !normalized(message.causationId) ||
    !normalized(message.sagaId) ||
    !normalized(message.orderId)
  ) {
    throw new Error("Invalid payment.refund.requested message envelope.");
  }
  if (!isRecord(message.payload)) {
    throw new Error("Invalid payment.refund.requested message payload.");
  }
  const payloadKeys = Object.keys(message.payload).sort();
  if (
    payloadKeys.length !== 2 ||
    payloadKeys[0] !== "paymentId" ||
    payloadKeys[1] !== "reason"
  ) {
    throw new Error("Invalid payment.refund.requested message payload.");
  }
  const paymentId = normalized(message.payload.paymentId);
  const reason = normalized(message.payload.reason);
  if (!paymentId || !reason) {
    throw new Error("Invalid payment.refund.requested message payload.");
  }
  return {
    eventId: normalized(message.eventId)!,
    eventName: "payment.refund.requested",
    eventVersion: 1,
    occurredAt: message.occurredAt,
    correlationId: normalized(message.correlationId)!,
    causationId: normalized(message.causationId)!,
    sagaId: normalized(message.sagaId)!,
    orderId: normalized(message.orderId)!,
    payload: { paymentId, reason },
  };
}

function refundedEvent(payment: Payment): PaymentRefundedMessage {
  const occurredAt = payment.refundedAt;
  const correlationId = payment.refundCorrelationId;
  const causationId = payment.refundCommandEventId;
  if (
    !occurredAt ||
    !correlationId ||
    !causationId ||
    !payment.providerPaymentId ||
    !payment.providerRefundId
  ) {
    throw new Error("Persisted payment refund result is incomplete.");
  }
  return {
    eventId: createDeterministicEventId(
      "payment.refunded",
      payment.id,
      "REFUNDED",
    ),
    eventName: "payment.refunded",
    eventVersion: 1,
    occurredAt: occurredAt.toISOString(),
    correlationId,
    causationId,
    sagaId: payment.sagaId,
    orderId: payment.orderId,
    payload: {
      paymentId: payment.id,
      budgetId: payment.budgetId,
      status: "REFUNDED",
      providerPaymentId: payment.providerPaymentId,
      providerRefundId: payment.providerRefundId,
    },
  };
}

function refundFailedEvent(payment: Payment): PaymentRefundFailedMessage {
  const occurredAt = payment.refundFailedAt;
  const correlationId = payment.refundCorrelationId;
  const causationId = payment.refundCommandEventId;
  const failureCode = payment.refundFailureCode;
  if (!occurredAt || !correlationId || !causationId || !failureCode) {
    throw new Error("Persisted payment refund rejection is incomplete.");
  }
  return {
    eventId: createDeterministicEventId(
      "payment.refund.failed",
      payment.id,
      `REFUND_FAILED:${failureCode}`,
    ),
    eventName: "payment.refund.failed",
    eventVersion: 1,
    occurredAt: occurredAt.toISOString(),
    correlationId,
    causationId,
    sagaId: payment.sagaId,
    orderId: payment.orderId,
    payload: {
      paymentId: payment.id,
      budgetId: payment.budgetId,
      status: "REFUND_FAILED",
      providerPaymentId: payment.providerPaymentId,
      failureCode,
    },
  };
}

function normalized(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result || undefined;
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !value.includes("T")) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
