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

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter(), new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle(serviceName)
    .setDescription("Phase 4 microservice API")
    .setVersion(serviceVersion)
    .addBearerAuth()
    .build();

  SwaggerModule.setup(
    "docs",
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(configService.get<number>("PORT", 3000));
}

void bootstrap();
