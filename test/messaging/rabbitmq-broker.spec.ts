import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { ConfigService } from "@nestjs/config";
import {
  RabbitMqConnection,
  RabbitMqConsumer,
  RabbitMqPublisher,
  type BrokerMessage,
} from "../../src/messaging/rabbitmq-broker";
import {
  integrationFailuresTotal,
  metricsRegistry,
} from "../../src/common/metrics/metrics.registry";

describe("RabbitMQ broker adapters", () => {
  const message: BrokerMessage = {
    eventId: "event-001",
    eventName: "budget.requested",
    eventVersion: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    correlationId: "correlation-001",
    causationId: "cause-001",
    sagaId: "saga-001",
    orderId: "order-001",
    payload: {},
  };

  function config(values: Record<string, unknown>): ConfigService {
    return {
      get: jest.fn(
        (key: string, fallback?: unknown) => values[key] ?? fallback,
      ),
    } as unknown as ConfigService;
  }

  function channel() {
    let confirmation: ((error: Error | null) => void) | undefined;
    const consumers: Array<(delivery: ConsumeMessage | null) => void> = [];
    const value = {
      assertExchange: jest.fn(),
      assertQueue: jest.fn(),
      prefetch: jest.fn(),
      consume: jest.fn((_queue, callback) => {
        consumers.push(callback);
        return Promise.resolve({ consumerTag: "consumer-tag" });
      }),
      publish: jest.fn((_exchange, _key, _content, _options, callback) => {
        confirmation = callback;
        return true;
      }),
      ack: jest.fn(),
      nack: jest.fn(),
    } as unknown as ConfirmChannel;
    return {
      value,
      confirm: (error: Error | null = null) => confirmation?.(error),
      consumers,
    };
  }

  function managedConnection(initial: ConfirmChannel) {
    const listeners = new Set<(channel: ConfirmChannel | undefined) => void>();
    const getChannel = jest.fn().mockResolvedValue(initial);
    return {
      getChannel,
      onChannelChange: jest.fn((listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      emit: (next: ConfirmChannel | undefined) =>
        listeners.forEach((listener) => listener(next)),
      listenerCount: () => listeners.size,
    } as unknown as RabbitMqConnection & {
      getChannel: jest.Mock;
      emit(channel: ConfirmChannel | undefined): void;
      listenerCount(): number;
    };
  }

  function delivery(retryCount = 0): ConsumeMessage {
    return {
      content: Buffer.from(JSON.stringify(message)),
      fields: { exchange: "orders.topic", routingKey: "budget.requested" },
      properties: { headers: { "x-retry-count": retryCount } },
    } as unknown as ConsumeMessage;
  }

  beforeEach(() => {
    metricsRegistry.resetMetrics();
  });

  it("waits for publisher confirmation before logging success", async () => {
    const broker = channel();
    const output = jest.spyOn(process.stdout, "write").mockImplementation();
    const publisher = new RabbitMqPublisher(
      managedConnection(broker.value),
      config({ SERVICE_NAME: "SERVICE_NAME" }),
    );

    const result = publisher.publish(
      "orders.topic",
      "budget.requested",
      message,
    );
    await new Promise(setImmediate);
    expect(broker.value.publish).toHaveBeenCalled();
    expect(output).not.toHaveBeenCalledWith(
      expect.stringContaining('"broker_message_published"'),
    );

    broker.confirm();
    await expect(result).resolves.toBeUndefined();
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('"correlationId":"correlation-001"'),
    );
    output.mockRestore();
  });

  it("rejects a publisher confirmation failure and acknowledges successful deliveries", async () => {
    const broker = channel();
    const publisher = new RabbitMqPublisher(
      managedConnection(broker.value),
      config({ SERVICE_NAME: "SERVICE_NAME" }),
    );
    const publishing = publisher.publish(
      "orders.topic",
      "budget.requested",
      message,
    );
    await new Promise(setImmediate);
    broker.confirm(new Error("broker rejected"));
    await expect(publishing).rejects.toThrow("broker rejected");

    const consumer = new RabbitMqConsumer(
      managedConnection(broker.value),
      config({}),
    );
    await consumer.subscribe("queue-a", jest.fn().mockResolvedValue(undefined));
    const accepted = delivery();
    broker.consumers[0](accepted);
    await new Promise(setImmediate);
    expect(broker.value.ack).toHaveBeenCalledWith(accepted);
  });

  it("handles a synchronous publish error and an invalid delivery without leaking metadata", async () => {
    const broker = channel();
    (broker.value.publish as jest.Mock).mockImplementation(() => {
      throw new Error("channel closed");
    });
    const publisher = new RabbitMqPublisher(
      managedConnection(broker.value),
      config({ SERVICE_NAME: "SERVICE_NAME" }),
    );
    await expect(
      publisher.publish("orders.topic", "budget.requested", message),
    ).rejects.toThrow("channel closed");
    await expect(integrationFailuresTotal.get()).resolves.toMatchObject({
      values: [
        expect.objectContaining({
          labels: { service: "billing-service", integration: "rabbitmq" },
          value: 1,
        }),
      ],
    });

    const consumer = new RabbitMqConsumer(
      managedConnection(broker.value),
      config({ RABBITMQ_MAX_RETRIES: 0 }),
    );
    await consumer.subscribe("queue-a", async () => {
      throw new Error("handler failed");
    });
    broker.consumers[0]({
      content: Buffer.from("invalid"),
      fields: { exchange: "orders.topic", routingKey: "budget.requested" },
      properties: { headers: {} },
    } as unknown as ConsumeMessage);
    await new Promise(setImmediate);
    expect(broker.value.publish).toHaveBeenCalledWith(
      "dead-letter.topic",
      "orders.topic.budget.requested",
      expect.any(Buffer),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("keeps the original delivery when retry confirmation fails", async () => {
    const broker = channel();
    const connection = managedConnection(broker.value);
    const consumer = new RabbitMqConsumer(
      connection,
      config({ SERVICE_NAME: "SERVICE_NAME", RABBITMQ_MAX_RETRIES: 1 }),
    );

    await consumer.subscribe("billing.budget.requests", async () => {
      throw new Error("handler failed");
    });
    broker.consumers[0](delivery());
    await new Promise(setImmediate);
    expect(broker.value.ack).not.toHaveBeenCalled();
    broker.confirm(new Error("broker rejected"));
    await new Promise(setImmediate);

    expect(broker.value.nack).toHaveBeenCalledWith(
      expect.anything(),
      false,
      true,
    );
    expect(broker.value.ack).not.toHaveBeenCalled();
  });

  it("acknowledges retry and dead-letter copies only after confirmation", async () => {
    const broker = channel();
    const consumer = new RabbitMqConsumer(
      managedConnection(broker.value),
      config({ SERVICE_NAME: "SERVICE_NAME", RABBITMQ_MAX_RETRIES: 1 }),
    );
    await consumer.subscribe("billing.budget.requests", async () => {
      throw new Error("handler failed");
    });

    const retry = delivery();
    broker.consumers[0](retry);
    await new Promise(setImmediate);
    expect(broker.value.publish).toHaveBeenLastCalledWith(
      "orders.topic.retry",
      "budget.requested",
      retry.content,
      expect.objectContaining({
        headers: expect.objectContaining({ "x-retry-count": 1 }),
      }),
      expect.any(Function),
    );
    broker.confirm();
    await new Promise(setImmediate);
    expect(broker.value.ack).toHaveBeenCalledWith(retry);

    const deadLetter = delivery(1);
    broker.consumers[0](deadLetter);
    await new Promise(setImmediate);
    expect(broker.value.publish).toHaveBeenLastCalledWith(
      "dead-letter.topic",
      "orders.topic.budget.requested",
      deadLetter.content,
      expect.any(Object),
      expect.any(Function),
    );
    broker.confirm();
    await new Promise(setImmediate);
    expect(broker.value.ack).toHaveBeenCalledWith(deadLetter);
  });

  it("deduplicates subscriptions and applies distinct queues once per channel", async () => {
    const broker = channel();
    const connection = managedConnection(broker.value);
    const consumer = new RabbitMqConsumer(connection, config({}));
    const handler = jest.fn().mockResolvedValue(undefined);

    await consumer.subscribe("queue-a", handler);
    await consumer.subscribe("queue-a", handler);
    await consumer.subscribe("queue-b", handler);

    expect(broker.value.consume).toHaveBeenCalledTimes(2);
    expect(broker.value.assertQueue).toHaveBeenCalledTimes(2);
    expect(broker.value.prefetch).toHaveBeenCalledTimes(1);
  });

  it("reapplies subscriptions once after a replacement channel is supplied", async () => {
    const first = channel();
    const second = channel();
    const connection = managedConnection(first.value);
    const consumer = new RabbitMqConsumer(connection, config({}));
    const handler = jest.fn().mockResolvedValue(undefined);

    await consumer.subscribe("queue-a", handler);
    connection.emit(undefined);
    connection.getChannel.mockResolvedValue(second.value);
    connection.emit(second.value);
    await new Promise(setImmediate);

    expect(first.value.consume).toHaveBeenCalledTimes(1);
    expect(second.value.consume).toHaveBeenCalledTimes(1);
    connection.emit(second.value);
    await new Promise(setImmediate);
    expect(second.value.consume).toHaveBeenCalledTimes(1);
  });

  it("uses one bounded timer for failed subscription recovery and resets it after success", async () => {
    jest.useFakeTimers();
    const first = channel();
    const second = channel();
    const connection = managedConnection(first.value);
    const consumer = new RabbitMqConsumer(connection, config({}));
    const handler = jest.fn().mockResolvedValue(undefined);

    await consumer.subscribe("queue-a", handler);
    connection.emit(undefined);
    connection.getChannel.mockRejectedValueOnce(
      new Error("temporarily unavailable"),
    );
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(100);
    expect(jest.getTimerCount()).toBe(1);
    connection.getChannel.mockResolvedValue(second.value);
    await jest.advanceTimersByTimeAsync(200);
    await Promise.resolve();

    expect(second.value.consume).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it("retries failed queue setup and unregisters lifecycle listeners on shutdown", async () => {
    jest.useFakeTimers();
    const broker = channel();
    (broker.value.assertQueue as jest.Mock)
      .mockRejectedValueOnce(new Error("queue failed"))
      .mockResolvedValue(undefined);
    const connection = managedConnection(broker.value);
    const consumer = new RabbitMqConsumer(connection, config({}));
    const handler = jest.fn().mockResolvedValue(undefined);

    await expect(consumer.subscribe("queue-a", handler)).rejects.toThrow(
      "subscription recovery failed",
    );
    expect(jest.getTimerCount()).toBe(1);
    await consumer.onModuleDestroy();

    expect(jest.getTimerCount()).toBe(0);
    expect(connection.listenerCount()).toBe(0);
    expect(() => connection.emit(undefined)).not.toThrow();
    jest.useRealTimers();
  });

  it("retries failed consumer registration", async () => {
    jest.useFakeTimers();
    const broker = channel();
    (broker.value.consume as jest.Mock)
      .mockRejectedValueOnce(new Error("consumer failed"))
      .mockResolvedValue({ consumerTag: "consumer-tag" });
    const connection = managedConnection(broker.value);
    const consumer = new RabbitMqConsumer(connection, config({}));

    await expect(
      consumer.subscribe("queue-a", jest.fn().mockResolvedValue(undefined)),
    ).rejects.toThrow("subscription recovery failed");
    await jest.advanceTimersByTimeAsync(100);

    expect(broker.value.consume).toHaveBeenCalledTimes(2);
    await consumer.onModuleDestroy();
    jest.useRealTimers();
  });
});
