import { ConfigService } from "@nestjs/config";
import { MercadoPagoConfigurationService } from "../../src/payment/infrastructure/config/mercado-pago-configuration.service";

describe("MercadoPagoConfigurationService", () => {
  it("selects only test credentials for the test environment", () => {
    const service = new MercadoPagoConfigurationService(
      new ConfigService({
        MERCADO_PAGO_ENVIRONMENT: "test",
        MERCADO_PAGO_TEST_ACCESS_TOKEN: "test-access-token",
        MERCADO_PAGO_TEST_WEBHOOK_SECRET: "test-webhook-secret",
        MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "production-access-token",
        MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "production-webhook-secret",
      }),
    );

    expect(service.getActiveConfiguration()).toEqual({
      environment: "test",
      accessToken: "test-access-token",
      webhookSecret: "test-webhook-secret",
    });
  });

  it("selects only production credentials for the production environment", () => {
    const service = new MercadoPagoConfigurationService(
      new ConfigService({
        MERCADO_PAGO_ENVIRONMENT: "production",
        MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN: "production-access-token",
        MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET: "production-webhook-secret",
      }),
    );

    expect(service.getActiveConfiguration()).toEqual({
      environment: "production",
      accessToken: "production-access-token",
      webhookSecret: "production-webhook-secret",
    });
  });
});
