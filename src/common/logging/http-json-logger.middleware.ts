import { Injectable, NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class HttpJsonLoggerMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    response.on("finish", () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const serviceName = this.configService.get<string>(
        "SERVICE_NAME",
        "billing-service",
      );

      const logEntry = {
        level: response.statusCode >= 500 ? "error" : "info",
        message: "http_request_completed",
        service: serviceName,
        correlationId: request.correlationId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      };

      process.stdout.write(`${JSON.stringify(logEntry)}\n`);
    });

    next();
  }
}
