import type { ChannelModel, ConfirmChannel } from "amqplib";
import { ConfigService } from "@nestjs/config";
import { RabbitMqConnection } from "../../src/messaging/rabbitmq-broker";

type Listener = () => void;

describe("RabbitMQ connection recovery", () => {
  function config(values: Record<string, unknown>): ConfigService {
    return {
      get: jest.fn(
        (key: string, fallback?: unknown) => values[key] ?? fallback,
      ),
    } as unknown as ConfigService;
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function resource(channelPromise?: Promise<ConfirmChannel>) {
    const listeners = new Map<string, Listener[]>();
    const channel = {
      on: jest.fn((event: string, listener: Listener) => {
        listeners.set(`channel:${event}`, [
          ...(listeners.get(`channel:${event}`) ?? []),
          listener,
        ]);
        return channel;
      }),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as ConfirmChannel;
    const connection = {
      on: jest.fn((event: string, listener: Listener) => {
        listeners.set(`connection:${event}`, [
          ...(listeners.get(`connection:${event}`) ?? []),
          listener,
        ]);
        return connection;
      }),
      createConfirmChannel: jest
        .fn()
        .mockImplementation(() => channelPromise ?? Promise.resolve(channel)),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChannelModel;
    return {
      connection,
      channel,
      emitConnection: (event: string) =>
        listeners.get(`connection:${event}`)?.forEach((listener) => listener()),
      emitChannel: (event: string) =>
        listeners.get(`channel:${event}`)?.forEach((listener) => listener()),
    };
  }

  it("is lazy, shares concurrent creation, and uses ConfirmChannel", async () => {
    const broker = resource();
    const connect = jest.fn().mockResolvedValue(broker.connection);
    const connection = new RabbitMqConnection(
      config({ MESSAGING_ENABLED: true, RABBITMQ_URL: "amqp://placeholder" }),
      connect,
    );

    expect(connect).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([
      connection.getChannel(),
      connection.getChannel(),
    ]);
    expect(first).toBe(broker.channel);
    expect(second).toBe(broker.channel);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(broker.connection.createConfirmChannel).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "close"])(
    "rejects and discards a late channel when connection emits %s during creation",
    async (event) => {
      const pending = deferred<ConfirmChannel>();
      const old = resource(pending.promise);
      const next = resource();
      const connect = jest
        .fn()
        .mockResolvedValueOnce(old.connection)
        .mockResolvedValueOnce(next.connection);
      const connection = new RabbitMqConnection(
        config({ MESSAGING_ENABLED: true, RABBITMQ_URL: "amqp://placeholder" }),
        connect,
      );

      const firstAttempt = connection.getChannel();
      await Promise.resolve();
      old.emitConnection(event);
      pending.resolve(old.channel);

      await expect(firstAttempt).rejects.toThrow(
        "invalidated during channel creation",
      );
      expect(old.channel.close).toHaveBeenCalled();
      await expect(connection.getChannel()).resolves.toBe(next.channel);
      old.emitConnection("close");
      await expect(connection.getChannel()).resolves.toBe(next.channel);
    },
  );

  it("retries after failed connection/channel creation and invalidates current resources", async () => {
    const failing = resource(Promise.reject(new Error("channel failed")));
    const healthy = resource();
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error("connection failed"))
      .mockResolvedValueOnce(failing.connection)
      .mockResolvedValueOnce(healthy.connection);
    const connection = new RabbitMqConnection(
      config({ MESSAGING_ENABLED: true, RABBITMQ_URL: "amqp://placeholder" }),
      connect,
    );

    await expect(connection.getChannel()).rejects.toThrow("connection failed");
    await expect(connection.getChannel()).rejects.toThrow("channel failed");
    await expect(connection.getChannel()).resolves.toBe(healthy.channel);
    healthy.emitChannel("close");
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it("rejects disabled or missing URL and shuts down without reconnecting", async () => {
    const connect = jest.fn();
    const disabled = new RabbitMqConnection(
      config({ MESSAGING_ENABLED: false }),
      connect,
    );
    expect(() => disabled.getChannel()).toThrow("Messaging is disabled.");

    const noUrl = new RabbitMqConnection(
      config({ MESSAGING_ENABLED: true }),
      connect,
    );
    await expect(noUrl.getChannel()).rejects.toThrow(
      "RABBITMQ_URL is required",
    );

    const broker = resource();
    const active = new RabbitMqConnection(
      config({ MESSAGING_ENABLED: true, RABBITMQ_URL: "amqp://placeholder" }),
      jest.fn().mockResolvedValue(broker.connection),
    );
    await active.getChannel();
    await active.onModuleDestroy();
    expect(broker.channel.close).toHaveBeenCalled();
    expect(broker.connection.close).toHaveBeenCalled();
    expect(() => active.getChannel()).toThrow("shutting down");
  });
});
