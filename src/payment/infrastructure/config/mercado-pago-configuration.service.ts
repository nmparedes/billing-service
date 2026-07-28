import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type MercadoPagoEnvironment = "test" | "production";

export interface MercadoPagoActiveConfiguration {
  environment: MercadoPagoEnvironment;
  accessToken: string;
  webhookSecret: string;
}

@Injectable()
export class MercadoPagoConfigurationService {
  constructor(private readonly configService: ConfigService) {}

  getActiveConfiguration(): MercadoPagoActiveConfiguration {
    const environment = this.configService.getOrThrow<MercadoPagoEnvironment>(
      "MERCADO_PAGO_ENVIRONMENT",
    );

    if (environment === "test") {
      return {
        environment,
        accessToken: this.configService.getOrThrow<string>(
          "MERCADO_PAGO_TEST_ACCESS_TOKEN",
        ),
        webhookSecret: this.configService.getOrThrow<string>(
          "MERCADO_PAGO_TEST_WEBHOOK_SECRET",
        ),
      };
    }

    return {
      environment,
      accessToken: this.configService.getOrThrow<string>(
        "MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN",
      ),
      webhookSecret: this.configService.getOrThrow<string>(
        "MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET",
      ),
    };
  }
}
