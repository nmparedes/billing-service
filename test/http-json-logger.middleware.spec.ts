import { ConfigService } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";
import { HttpJsonLoggerMiddleware } from "../src/common/logging/http-json-logger.middleware";

describe("HttpJsonLoggerMiddleware", () => {
  const createResponse = (
    statusCode: number,
  ): { response: Response; callbacks: Record<string, () => void> } => {
    const callbacks: Record<string, () => void> = {};
    const response = {
      statusCode,
      on: jest.fn((event: string, callback: () => void) => {
        callbacks[event] = callback;
        return response;
      }),
    } as unknown as Response;

    return { response, callbacks };
  };

  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("writes an info JSON log entry for successful requests", () => {
    const configService = {
      get: jest.fn().mockReturnValue("billing-service"),
    } as unknown as ConfigService;
    const middleware = new HttpJsonLoggerMiddleware(configService);
    const request = {
      correlationId: "corr-1",
      method: "GET",
      originalUrl: "/health",
    } as Request;
    const { response, callbacks } = createResponse(200);
    const next = jest.fn() as NextFunction;

    middleware.use(request, response, next);
    callbacks.finish();

    expect(next).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"info"'),
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"correlationId":"corr-1"'),
    );
  });

  it("writes an error JSON log entry for failed requests", () => {
    const configService = {
      get: jest.fn().mockReturnValue("billing-service"),
    } as unknown as ConfigService;
    const middleware = new HttpJsonLoggerMiddleware(configService);
    const request = {
      correlationId: "corr-2",
      method: "POST",
      originalUrl: "/orders",
    } as Request;
    const { response, callbacks } = createResponse(500);

    middleware.use(request, response, jest.fn() as NextFunction);
    callbacks.finish();

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"error"'),
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"path":"/orders"'),
    );
  });
});
