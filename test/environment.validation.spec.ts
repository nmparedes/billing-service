import "reflect-metadata";
import { validateEnvironment } from "../src/common/config/environment.validation";

describe("validateEnvironment", () => {
  it("uses safe defaults for optional values", () => {
    const config = validateEnvironment(paymentEnvironment());

    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(3000);
    expect(config.SERVICE_NAME).toBe("billing-service");
    expect(config.SERVICE_VERSION).toBe("0.1.0");
    expect(config.LOG_FORMAT).toBe("json");
    expect(config.METRICS_ENABLED).toBe(true);
    expect(config.CONSUMED_MESSAGE_LEASE_MS).toBe(300000);
    expect(config.PAYMENT_REFUND_LEASE_MS).toBe(300000);
  });

  it("accepts explicit service settings", () => {
    const config = validateEnvironment({
      ...paymentEnvironment(),
      NODE_ENV: "test",
      PORT: "4000",
      SERVICE_NAME: "billing-service",
      SERVICE_VERSION: "1.2.3",
      LOG_LEVEL: "debug",
      JWT_SECRET: "test-secret",
      JWT_ISSUER: "test-issuer",
      JWT_AUDIENCE: "test-audience",
      MONGODB_URI: "mongodb://localhost:27017/billing-test",
      MONGODB_SERVER_SELECTION_TIMEOUT_MS: "1500",
      METRICS_ENABLED: "false",
      MERCADO_PAGO_ENVIRONMENT: "production",
      MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "production-access-token",
      MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "production-webhook-secret",
      MERCADO_PAGO_NOTIFICATION_URL:
        "https://example.test/webhooks/mercado-pago",
      MERCADO_PAGO_SUCCESS_URL: "https://example.test/payments/success",
      MERCADO_PAGO_FAILURE_URL: "https://example.test/payments/failure",
      MERCADO_PAGO_PENDING_URL: "https://example.test/payments/pending",
    });

    expect(config.NODE_ENV).toBe("test");
    expect(config.PORT).toBe(4000);
    expect(config.SERVICE_NAME).toBe("billing-service");
    expect(config.SERVICE_VERSION).toBe("1.2.3");
    expect(config.LOG_LEVEL).toBe("debug");
    expect(config.JWT_SECRET).toBe("test-secret");
    expect(config.JWT_ISSUER).toBe("test-issuer");
    expect(config.JWT_AUDIENCE).toBe("test-audience");
    expect(config.MONGODB_URI).toBe("mongodb://localhost:27017/billing-test");
    expect(config.MONGODB_SERVER_SELECTION_TIMEOUT_MS).toBe(1500);
    expect(config.METRICS_ENABLED).toBe(false);
    expect(config.MERCADO_PAGO_ENVIRONMENT).toBe("production");
  });

  it("rejects invalid environment values", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "invalid",
        PORT: "0",
        LOG_FORMAT: "plain",
        MONGODB_URI: "not-a-mongodb-url",
        MERCADO_PAGO_ENVIRONMENT: "invalid",
        MERCADO_PAGO_NOTIFICATION_URL: "not-a-url",
        MERCADO_PAGO_SUCCESS_URL: "not-a-url",
        MERCADO_PAGO_FAILURE_URL: "not-a-url",
        MERCADO_PAGO_PENDING_URL: "not-a-url",
      }),
    ).toThrow();
  });

  it("rejects missing Mercado Pago configuration", () => {
    expect(() => validateEnvironment({})).toThrow();
  });

  it("rejects a missing credential for the selected Mercado Pago environment", () => {
    expect(() =>
      validateEnvironment({
        ...paymentEnvironment(),
        MERCADO_PAGO_TEST_WEBHOOK_SECRET: "",
      }),
    ).toThrow();
  });

  it("rejects a missing production credential when production is selected", () => {
    expect(() =>
      validateEnvironment({
        ...paymentEnvironment(),
        MERCADO_PAGO_ENVIRONMENT: "production",
      }),
    ).toThrow();
  });

  it("requires a RabbitMQ URL only when messaging is enabled", () => {
    expect(() =>
      validateEnvironment({
        ...paymentEnvironment(),
        MESSAGING_ENABLED: "true",
      }),
    ).toThrow("RABBITMQ_URL is required");

    expect(
      validateEnvironment({
        ...paymentEnvironment(),
        MESSAGING_ENABLED: "true",
        RABBITMQ_URL: "amqp://placeholder",
        RABBITMQ_MAX_RETRIES: "2",
      }),
    ).toMatchObject({ MESSAGING_ENABLED: true, RABBITMQ_MAX_RETRIES: 2 });
  });

  it("requires a lease long enough for normal processing", () => {
    expect(() =>
      validateEnvironment({
        ...paymentEnvironment(),
        CONSUMED_MESSAGE_LEASE_MS: "1000",
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        ...paymentEnvironment(),
        PAYMENT_REFUND_LEASE_MS: "59999",
      }),
    ).toThrow();
  });
});

function paymentEnvironment() {
  return {
    MERCADO_PAGO_ENVIRONMENT: "test",
    MERCADO_PAGO_TEST_ACCESS_TOKEN: "test-access-token",
    MERCADO_PAGO_TEST_WEBHOOK_SECRET: "test-webhook-secret",
    MERCADO_PAGO_NOTIFICATION_URL: "https://example.test/webhooks/mercado-pago",
    MERCADO_PAGO_SUCCESS_URL: "https://example.test/payments/success",
    MERCADO_PAGO_FAILURE_URL: "https://example.test/payments/failure",
    MERCADO_PAGO_PENDING_URL: "https://example.test/payments/pending",
  };
}
