import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { httpRequestDurationSeconds } from "./metrics.registry";

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const endTimer = httpRequestDurationSeconds.startTimer({
      method: request.method,
      route: request.route?.path ?? request.path,
    });

    response.on("finish", () => {
      endTimer({
        status_code: String(response.statusCode),
      });
    });

    next();
  }
}
