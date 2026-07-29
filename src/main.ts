import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import "reflect-metadata";
import { AppModule } from "./app.module";
import { DomainExceptionFilter } from "./common/filters/domain-exception.filter";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const configService = app.get(ConfigService);
  const serviceName = configService.get<string>(
    "SERVICE_NAME",
    "billing-service",
  );
  const serviceVersion = configService.get<string>("SERVICE_VERSION", "0.1.0");
  const swaggerBasePath = normalizeSwaggerBasePath(
    configService.get<string>("SWAGGER_BASE_PATH"),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter(), new HttpExceptionFilter());

  const swaggerConfigBuilder = new DocumentBuilder()
    .setTitle(serviceName)
    .setDescription("Phase 4 microservice API")
    .setVersion(serviceVersion)
    .addBearerAuth();

  if (swaggerBasePath) {
    swaggerConfigBuilder.addServer(swaggerBasePath);
  }

  SwaggerModule.setup(
    "docs",
    app,
    SwaggerModule.createDocument(app, swaggerConfigBuilder.build()),
  );

  await app.listen(configService.get<number>("PORT", 3000));
}

function normalizeSwaggerBasePath(basePath?: string): string | undefined {
  const trimmedBasePath = basePath?.trim();
  if (!trimmedBasePath) {
    return undefined;
  }

  const prefixedBasePath = trimmedBasePath.startsWith("/")
    ? trimmedBasePath
    : `/${trimmedBasePath}`;

  return prefixedBasePath.replace(/\/+$/, "") || undefined;
}

void bootstrap();
