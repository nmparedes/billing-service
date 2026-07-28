import { ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { IS_PUBLIC_KEY } from "../src/auth/decorators/public.decorator";
import { BudgetController } from "../src/budget/infrastructure/controllers/budget.controller";
import { MONGO_CLIENT } from "../src/database/database.constants";
import { HealthController } from "../src/health/health.controller";
import { PaymentController } from "../src/payment/infrastructure/controllers/payment.controller";

describe("HealthController", () => {
  let controller: HealthController;
  const command = jest.fn();
  const db = jest.fn(() => ({ command }));
  const mongoClient = { db };
  let databaseClient: typeof mongoClient;

  beforeEach(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.SERVICE_NAME = "billing-service";
    process.env.MERCADO_PAGO_ENVIRONMENT = "test";
    process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN = "test-access-token";
    process.env.MERCADO_PAGO_TEST_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.MERCADO_PAGO_NOTIFICATION_URL =
      "https://example.test/webhooks/mercado-pago";
    process.env.MERCADO_PAGO_SUCCESS_URL =
      "https://example.test/payments/success";
    process.env.MERCADO_PAGO_FAILURE_URL =
      "https://example.test/payments/failure";
    process.env.MERCADO_PAGO_PENDING_URL =
      "https://example.test/payments/pending";
    command.mockResolvedValue({ ok: 1 });
    command.mockClear();
    db.mockClear();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MONGO_CLIENT)
      .useValue(mongoClient)
      .compile();

    controller = moduleRef.get(HealthController);
    databaseClient = moduleRef.get(MONGO_CLIENT);
  });

  it("returns liveness status without consulting MongoDB", () => {
    expect(controller.health()).toEqual({
      status: "ok",
      service: "billing-service",
    });
    expect(db).not.toHaveBeenCalled();
  });

  it("returns readiness status with version when MongoDB responds", async () => {
    expect(databaseClient).toBe(mongoClient);
    await expect(controller.ready()).resolves.toEqual({
      status: "ok",
      service: "billing-service",
      version: "0.1.0",
    });
    expect(db).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith({ ping: 1 });
  });

  it("returns a sanitized 503 when MongoDB is unavailable", async () => {
    command.mockRejectedValueOnce(
      new Error("mongodb://user:password@sensitive-host:27017/billing"),
    );

    try {
      await controller.ready();
      fail("Expected readiness to fail when MongoDB is unavailable");
    } catch (error) {
      expect(error).toMatchObject(
        new ServiceUnavailableException({
          status: "unavailable",
          service: "billing-service",
        }),
      );
      const response = (error as ServiceUnavailableException).getResponse();
      expect(JSON.stringify(response)).not.toContain("sensitive-host");
      expect(JSON.stringify(response)).not.toContain("password");
      expect(JSON.stringify(response)).not.toContain("mongodb://");
    }
  });

  it("exposes Prometheus metrics", async () => {
    await expect(controller.metrics()).resolves.toContain("# HELP");
  });

  it("marks operational endpoints as public while business controllers stay protected", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, HealthController)).toBe(true);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, BudgetController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, PaymentController),
    ).toBeUndefined();
  });
});
