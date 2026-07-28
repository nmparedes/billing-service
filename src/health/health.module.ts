import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CorrelationIdMiddleware } from "../common/logging/correlation-id.middleware";
import { HttpJsonLoggerMiddleware } from "../common/logging/http-json-logger.middleware";
import { HttpMetricsMiddleware } from "../common/metrics/http-metrics.middleware";
import { DatabaseModule } from "../database/database.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [HealthController],
})
export class HealthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        CorrelationIdMiddleware,
        HttpJsonLoggerMiddleware,
        HttpMetricsMiddleware,
      )
      .forRoutes("*");
  }
}
