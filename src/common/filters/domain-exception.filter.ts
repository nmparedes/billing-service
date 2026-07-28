import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { DomainException } from "../exceptions/domain.exception";

@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = this.mapStatus(exception.code);

    response.status(status).json({
      statusCode: status,
      code: exception.code,
      message: exception.message,
      error: HttpStatus[status],
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId: request.correlationId,
      details: exception.details,
    });
  }

  private mapStatus(code: string): number {
    if (code.includes("NOT_FOUND")) {
      return HttpStatus.NOT_FOUND;
    }
    if (code.includes("ALREADY_EXISTS") || code.includes("CONFLICT")) {
      return HttpStatus.CONFLICT;
    }
    if (code.includes("UNAUTHORIZED")) {
      return HttpStatus.UNAUTHORIZED;
    }
    if (code.includes("FORBIDDEN")) {
      return HttpStatus.FORBIDDEN;
    }
    return HttpStatus.BAD_REQUEST;
  }
}
