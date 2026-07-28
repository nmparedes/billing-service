import {
  connect,
  type ConfirmChannel,
  type ChannelModel,
  type ConsumeMessage,
  type Options,
} from "amqplib";
import {
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { incrementIntegrationFailureMetric } from "../common/metrics/metrics.registry";

export const MESSAGE_PUBLISHER = Symbol("MESSAGE_PUBLISHER");
export const MESSAGE_CONSUMER = Symbol("MESSAGE_CONSUMER");
export const RABBITMQ_CONNECT = Symbol("RABBITMQ_CONNECT");

export interface BrokerMessage {
  eventId: string;
  eventName: string;
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  causationId: string;
  sagaId: string;
  orderId: string;
  payload: unknown;
}

export interface MessagePublisher {
  publish(
    exchange: string,
    routingKey: string,
    message: BrokerMessage,
  ): Promise<void>;
}

export interface MessageConsumer {
  subscribe(
    queue: string,
    handler: (message: BrokerMessage) => Promise<void>,
  ): Promise<void>;
}

type RabbitMqConnect = (url: string) => Promise<ChannelModel>;
type ChannelListener = (channel: ConfirmChannel | undefined) => void;
type SubscriptionHandler = (message: BrokerMessage) => Promise<void>;

interface Subscription {
  queue: string;
  handler: SubscriptionHandler;
  appliedChannel?: ConfirmChannel;
}

const INITIAL_RECOVERY_DELAY_MS = 100;
const MAX_RECOVERY_DELAY_MS = 1_000;

@Injectable()
export class RabbitMqConnection implements OnModuleDestroy {
  private channelPromise?: Promise<ConfirmChannel>;
  private channel?: ConfirmChannel;
  private connection?: ChannelModel;
  private activeAttempt?: symbol;
  private shuttingDown = false;
  private readonly channelListeners = new Set<ChannelListener>();

  constructor(
    private readonly configService: ConfigService,
    @Inject(RABBITMQ_CONNECT)
    private readonly connectToRabbitMq: RabbitMqConnect,
  ) {}

  getChannel(): Promise<ConfirmChannel> {
    if (this.shuttingDown) throw new Error("Messaging is shutting down.");
    if (!this.configService.get<boolean>("MESSAGING_ENABLED", false)) {
      throw new Error("Messaging is disabled.");
    }

    if (!this.channelPromise) {
      const attempt = Symbol("rabbitmq-channel-attempt");
      this.activeAttempt = attempt;
      const promise = this.createChannel(attempt);
      this.channelPromise = promise;
      void promise.catch(() => {
        if (this.channelPromise === promise) this.channelPromise = undefined;
      });
    }
    return this.channelPromise;
  }

  onChannelChange(listener: ChannelListener): () => void {
    this.channelListeners.add(listener);
    return () => this.channelListeners.delete(listener);
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    this.channelPromise = undefined;
    this.activeAttempt = undefined;
    this.emitChannelChange(undefined);
    await this.closeQuietly(channel);
    await this.closeQuietly(connection);
    this.channelListeners.clear();
  }

  private async createChannel(attempt: symbol): Promise<ConfirmChannel> {
    const url = this.configService.get<string>("RABBITMQ_URL");
    if (!url)
      throw new Error("RABBITMQ_URL is required when messaging is enabled.");

    let connection: ChannelModel | undefined;
    let channel: ConfirmChannel | undefined;
    try {
      connection = await this.connectToRabbitMq(url);
      if (this.shuttingDown || this.activeAttempt !== attempt) {
        throw new Error("RabbitMQ connection attempt was invalidated.");
      }

      this.connection = connection;
      this.registerConnectionListeners(connection);
      channel = await connection.createConfirmChannel();

      if (
        this.shuttingDown ||
        this.activeAttempt !== attempt ||
        this.connection !== connection
      ) {
        throw new Error(
          "RabbitMQ connection was invalidated during channel creation.",
        );
      }

      this.channel = channel;
      this.registerChannelListeners(channel, connection);
      this.emitChannelChange(channel);
      return channel;
    } catch (error) {
      if (this.channel === channel) this.channel = undefined;
      if (this.connection === connection) this.connection = undefined;
      if (this.activeAttempt === attempt) this.activeAttempt = undefined;
      await this.closeQuietly(channel);
      await this.closeQuietly(connection);
      throw error;
    }
  }

  private registerConnectionListeners(connection: ChannelModel): void {
    connection.on("error", () => this.invalidateConnection(connection));
    connection.on("close", () => this.invalidateConnection(connection));
  }

  private registerChannelListeners(
    channel: ConfirmChannel,
    connection: ChannelModel,
  ): void {
    channel.on("error", () => this.invalidateChannel(channel, connection));
    channel.on("close", () => this.invalidateChannel(channel, connection));
  }

  private invalidateConnection(connection: ChannelModel): void {
    if (this.shuttingDown || this.connection !== connection) return;
    this.channel = undefined;
    this.channelPromise = undefined;
    this.connection = undefined;
    this.activeAttempt = undefined;
    this.emitChannelChange(undefined);
    void this.closeQuietly(connection);
  }

  private invalidateChannel(
    channel: ConfirmChannel,
    connection: ChannelModel,
  ): void {
    if (
      this.shuttingDown ||
      this.channel !== channel ||
      this.connection !== connection
    )
      return;
    this.channel = undefined;
    this.channelPromise = undefined;
    this.connection = undefined;
    this.activeAttempt = undefined;
    this.emitChannelChange(undefined);
    void this.closeQuietly(connection);
  }

  private emitChannelChange(channel: ConfirmChannel | undefined): void {
    for (const listener of this.channelListeners) {
      try {
        listener(channel);
      } catch {
        // A lifecycle listener must not prevent other listeners from recovering.
      }
    }
  }

  private async closeQuietly(
    resource: { close(): Promise<void> } | undefined,
  ): Promise<void> {
    if (!resource) return;
    try {
      await resource.close();
    } catch {
      // A closed resource must not block recovery or shutdown.
    }
  }
}

@Injectable()
export class RabbitMqPublisher implements MessagePublisher {
  constructor(
    private readonly connection: RabbitMqConnection,
    private readonly configService: ConfigService,
  ) {}

  async publish(
    exchange: string,
    routingKey: string,
    message: BrokerMessage,
  ): Promise<void> {
    try {
      const channel = await this.connection.getChannel();
      await channel.assertExchange(exchange, "topic", { durable: true });
      await publishConfirmed(
        channel,
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
          contentType: "application/json",
          messageId: message.eventId,
          persistent: true,
          timestamp: Date.now(),
          headers: this.headers(message),
        },
      );
      this.log("info", "broker_message_published", message, {
        exchange,
        routingKey,
      });
    } catch (error) {
      incrementIntegrationFailureMetric("rabbitmq");
      this.log("error", "broker_message_publish_failed", message, {
        exchange,
        routingKey,
      });
      throw error;
    }
  }

  private headers(message: BrokerMessage): Record<string, string | number> {
    return {
      correlationId: message.correlationId,
      causationId: message.causationId,
      sagaId: message.sagaId,
      eventVersion: message.eventVersion,
    };
  }

  private log(
    level: "info" | "error",
    message: string,
    brokerMessage: BrokerMessage,
    details: Record<string, string>,
  ): void {
    writeBrokerLog(this.configService, level, message, brokerMessage, details);
  }
}

@Injectable()
export class RabbitMqConsumer implements MessageConsumer, OnModuleDestroy {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly handlerIds = new WeakMap<SubscriptionHandler, number>();
  private nextHandlerId = 1;
  private currentChannel?: ConfirmChannel;
  private configuredChannel?: ConfirmChannel;
  private applying?: Promise<void>;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private recoveryDelayMs = INITIAL_RECOVERY_DELAY_MS;
  private shuttingDown = false;
  private readonly removeChannelListener: () => void;

  constructor(
    private readonly connection: RabbitMqConnection,
    private readonly configService: ConfigService,
  ) {
    this.removeChannelListener = this.connection.onChannelChange((channel) => {
      if (this.currentChannel === channel) return;
      this.currentChannel = channel;
      this.configuredChannel = undefined;
      for (const subscription of this.subscriptions.values()) {
        subscription.appliedChannel = undefined;
      }
      if (!channel) {
        this.scheduleRecovery();
        return;
      }
      this.clearRecoveryTimer();
      void this.restoreSubscriptions();
    });
  }

  async subscribe(queue: string, handler: SubscriptionHandler): Promise<void> {
    if (this.shuttingDown) throw new Error("Messaging is shutting down.");
    const key = this.subscriptionKey(queue, handler);
    if (!this.subscriptions.has(key))
      this.subscriptions.set(key, { queue, handler });
    await this.restoreSubscriptions();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    this.clearRecoveryTimer();
    this.subscriptions.clear();
    this.currentChannel = undefined;
    this.configuredChannel = undefined;
    this.removeChannelListener();
    await this.applying?.catch(() => undefined);
  }

  private subscriptionKey(queue: string, handler: SubscriptionHandler): string {
    let id = this.handlerIds.get(handler);
    if (!id) {
      id = this.nextHandlerId++;
      this.handlerIds.set(handler, id);
    }
    return `${queue}:${id}`;
  }

  private async restoreSubscriptions(): Promise<void> {
    if (this.shuttingDown || this.subscriptions.size === 0) return;
    if (this.applying) return this.applying;

    const applying = this.applySubscriptions();
    this.applying = applying;
    let failed = false;
    try {
      await applying;
      this.recoveryDelayMs = INITIAL_RECOVERY_DELAY_MS;
      this.clearRecoveryTimer();
    } catch {
      failed = true;
      throw new Error("RabbitMQ subscription recovery failed.");
    } finally {
      if (this.applying === applying) this.applying = undefined;
      if (failed) this.scheduleRecovery();
    }
  }

  private async applySubscriptions(): Promise<void> {
    const channel = await this.connection.getChannel();
    if (this.shuttingDown) return;
    this.currentChannel = channel;

    if (this.configuredChannel !== channel) {
      await channel.prefetch(1);
      if (this.currentChannel !== channel || this.shuttingDown) {
        throw new Error(
          "RabbitMQ channel was invalidated during subscription setup.",
        );
      }
      this.configuredChannel = channel;
    }

    for (const subscription of this.subscriptions.values()) {
      if (subscription.appliedChannel === channel) continue;
      await channel.assertQueue(subscription.queue, { durable: true });
      if (this.currentChannel !== channel || this.shuttingDown) {
        throw new Error(
          "RabbitMQ channel was invalidated during subscription setup.",
        );
      }
      await channel.consume(subscription.queue, (message) => {
        void this.handleMessage(
          channel,
          subscription.queue,
          message,
          subscription.handler,
        ).catch(() => {
          // Consumer callbacks cannot return rejected promises to amqplib.
        });
      });
      if (this.currentChannel !== channel || this.shuttingDown) {
        throw new Error(
          "RabbitMQ channel was invalidated during subscription setup.",
        );
      }
      subscription.appliedChannel = channel;
    }
  }

  private scheduleRecovery(): void {
    if (
      this.shuttingDown ||
      this.subscriptions.size === 0 ||
      this.recoveryTimer ||
      this.applying
    )
      return;

    const delay = this.recoveryDelayMs;
    this.recoveryDelayMs = Math.min(
      this.recoveryDelayMs * 2,
      MAX_RECOVERY_DELAY_MS,
    );
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      void this.restoreSubscriptions().catch(() => undefined);
    }, delay);
  }

  private clearRecoveryTimer(): void {
    if (!this.recoveryTimer) return;
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
  }

  private async handleMessage(
    channel: ConfirmChannel,
    queue: string,
    delivery: ConsumeMessage | null,
    handler: SubscriptionHandler,
  ): Promise<void> {
    if (!delivery) return;

    let message: BrokerMessage | undefined;
    try {
      message = JSON.parse(delivery.content.toString("utf8")) as BrokerMessage;
      await handler(message);
      channel.ack(delivery);
      this.log("info", "broker_message_processed", message, { queue });
    } catch {
      await this.republishFailure(channel, queue, delivery, message);
    }
  }

  private async republishFailure(
    channel: ConfirmChannel,
    queue: string,
    delivery: ConsumeMessage,
    message: BrokerMessage | undefined,
  ): Promise<void> {
    const retryCount = Number(
      delivery.properties.headers?.["x-retry-count"] ?? 0,
    );
    const shouldRetry = retryCount < this.maximumRetries();
    const targetExchange = shouldRetry
      ? `${delivery.fields.exchange}.retry`
      : "dead-letter.topic";
    const targetRoutingKey = shouldRetry
      ? delivery.fields.routingKey
      : `${delivery.fields.exchange}.${delivery.fields.routingKey}`;
    const logMessage = message ?? this.unknownMessage(delivery);

    try {
      await publishConfirmed(
        channel,
        targetExchange,
        targetRoutingKey,
        delivery.content,
        {
          ...delivery.properties,
          persistent: true,
          headers: {
            ...delivery.properties.headers,
            "x-retry-count": retryCount + 1,
          },
        },
      );
      channel.ack(delivery);
      this.log("error", "broker_message_processing_failed", logMessage, {
        queue,
        targetExchange,
      });
    } catch {
      incrementIntegrationFailureMetric("rabbitmq");
      try {
        channel.nack(delivery, false, true);
      } catch {
        // A closed channel leaves the unacknowledged delivery recoverable.
      }
      this.log("error", "broker_message_republish_failed", logMessage, {
        queue,
        targetExchange,
      });
    }
  }

  private maximumRetries(): number {
    return this.configService.get<number>("RABBITMQ_MAX_RETRIES", 3);
  }

  private unknownMessage(delivery: ConsumeMessage): BrokerMessage {
    const headers = delivery.properties.headers ?? {};
    return {
      eventId: String(delivery.properties.messageId ?? "unknown"),
      eventName: "unknown",
      eventVersion: Number(headers.eventVersion ?? 1),
      occurredAt: "unknown",
      correlationId: String(headers.correlationId ?? "unknown"),
      causationId: String(headers.causationId ?? "unknown"),
      sagaId: String(headers.sagaId ?? "unknown"),
      orderId: "unknown",
      payload: undefined,
    };
  }

  private log(
    level: "info" | "error",
    message: string,
    brokerMessage: BrokerMessage,
    details: Record<string, string>,
  ): void {
    writeBrokerLog(this.configService, level, message, brokerMessage, details);
  }
}

function publishConfirmed(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  content: Buffer,
  options: Options.Publish,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      channel.publish(exchange, routingKey, content, options, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function writeBrokerLog(
  configService: ConfigService,
  level: "info" | "error",
  message: string,
  brokerMessage: BrokerMessage,
  details: Record<string, string>,
): void {
  process.stdout.write(
    `${JSON.stringify({
      level,
      message,
      service: configService.get<string>("SERVICE_NAME", "billing-service"),
      eventId: brokerMessage.eventId,
      eventName: brokerMessage.eventName,
      correlationId: brokerMessage.correlationId,
      causationId: brokerMessage.causationId,
      sagaId: brokerMessage.sagaId,
      orderId: brokerMessage.orderId,
      ...details,
    })}\n`,
  );
}

@Module({
  imports: [ConfigModule],
  providers: [
    { provide: RABBITMQ_CONNECT, useValue: connect },
    RabbitMqConnection,
    RabbitMqPublisher,
    RabbitMqConsumer,
    { provide: MESSAGE_PUBLISHER, useExisting: RabbitMqPublisher },
    { provide: MESSAGE_CONSUMER, useExisting: RabbitMqConsumer },
  ],
  exports: [MESSAGE_PUBLISHER, MESSAGE_CONSUMER, RabbitMqConnection],
})
export class MessagingModule {}
