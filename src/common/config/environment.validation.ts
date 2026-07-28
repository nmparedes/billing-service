import { plainToInstance, Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  validateSync,
} from "class-validator";

export class EnvironmentVariables {
  @IsOptional()
  @IsIn(["development", "test", "production"])
  NODE_ENV = "development";

  @Transform(({ value }) => Number(value ?? 3000))
  @IsInt()
  @Min(1)
  PORT = 3000;

  @IsOptional()
  @IsString()
  SERVICE_NAME = "billing-service";

  @IsOptional()
  @IsString()
  SERVICE_VERSION = "0.1.0";

  @IsOptional()
  @IsString()
  LOG_LEVEL = "info";

  @IsOptional()
  @IsIn(["json"])
  LOG_FORMAT = "json";

  @IsOptional()
  @IsString()
  JWT_SECRET?: string;

  @IsOptional()
  @IsString()
  JWT_ISSUER = "fiap-tech-challenge-auth-function";

  @IsOptional()
  @IsString()
  JWT_AUDIENCE = "fiap-tech-challenge-api";

  @IsOptional()
  @IsIn(["ACTIVE"])
  JWT_REQUIRED_CUSTOMER_STATUS = "ACTIVE";

  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ["mongodb", "mongodb+srv"] })
  MONGODB_URI = "mongodb://localhost:27017/billing";

  @Transform(({ value }) => Number(value ?? 5000))
  @IsInt()
  @Min(1)
  MONGODB_SERVER_SELECTION_TIMEOUT_MS = 5000;

  @Transform(
    ({ value }) => value === undefined || value === "true" || value === true,
  )
  @IsBoolean()
  METRICS_ENABLED = true;

  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  MESSAGING_ENABLED = false;

  @IsOptional()
  @IsString()
  RABBITMQ_URL?: string;

  @Transform(({ value }) => Number(value ?? 3))
  @IsInt()
  @Min(0)
  RABBITMQ_MAX_RETRIES = 3;

  @Transform(({ value }) => Number(value ?? 300000))
  @IsInt()
  @Min(30000)
  CONSUMED_MESSAGE_LEASE_MS = 300000;

  @Transform(({ value }) => Number(value ?? 300000))
  @IsInt()
  @Min(60000)
  PAYMENT_REFUND_LEASE_MS = 300000;

  @IsIn(["test", "production"])
  MERCADO_PAGO_ENVIRONMENT!: "test" | "production";

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  MERCADO_PAGO_TEST_ACCESS_TOKEN?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  MERCADO_PAGO_TEST_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET?: string;

  @IsUrl({ protocols: ["https"], require_tld: false })
  MERCADO_PAGO_NOTIFICATION_URL!: string;

  @IsUrl({ protocols: ["https"], require_tld: false })
  MERCADO_PAGO_SUCCESS_URL!: string;

  @IsUrl({ protocols: ["https"], require_tld: false })
  MERCADO_PAGO_FAILURE_URL!: string;

  @IsUrl({ protocols: ["https"], require_tld: false })
  MERCADO_PAGO_PENDING_URL!: string;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  const isTestEnvironment = validatedConfig.MERCADO_PAGO_ENVIRONMENT === "test";
  const accessToken = isTestEnvironment
    ? validatedConfig.MERCADO_PAGO_TEST_ACCESS_TOKEN
    : validatedConfig.MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN;
  const webhookSecret = isTestEnvironment
    ? validatedConfig.MERCADO_PAGO_TEST_WEBHOOK_SECRET
    : validatedConfig.MERCADO_PAGO_PRODUCTION_WEBHOOK_SECRET;
  if (!accessToken || !webhookSecret) {
    throw new Error(
      "The selected Mercado Pago environment requires an access token and webhook secret.",
    );
  }

  if (
    validatedConfig.MESSAGING_ENABLED &&
    !validatedConfig.RABBITMQ_URL?.trim()
  ) {
    throw new Error("RABBITMQ_URL is required when messaging is enabled.");
  }

  return validatedConfig;
}
