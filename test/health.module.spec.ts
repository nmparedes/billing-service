import type { MiddlewareConsumer } from "@nestjs/common";
import { CorrelationIdMiddleware } from "../src/common/logging/correlation-id.middleware";
import { HttpJsonLoggerMiddleware } from "../src/common/logging/http-json-logger.middleware";
import { HttpMetricsMiddleware } from "../src/common/metrics/http-metrics.middleware";
import { HealthModule } from "../src/health/health.module";

describe("HealthModule", () => {
  it("registers correlation, JSON logging and metrics middleware", () => {
    const forRoutes = jest.fn();
    const apply = jest.fn().mockReturnValue({ forRoutes });
    const consumer = { apply } as unknown as MiddlewareConsumer;

    new HealthModule().configure(consumer);

    expect(apply).toHaveBeenCalledWith(
      CorrelationIdMiddleware,
      HttpJsonLoggerMiddleware,
      HttpMetricsMiddleware,
    );
    expect(forRoutes).toHaveBeenCalledWith("*");
  });
});
