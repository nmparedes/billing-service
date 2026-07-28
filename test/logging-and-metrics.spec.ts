import type { NextFunction, Request, Response } from "express";
import {
  CorrelationIdMiddleware,
  CORRELATION_ID_HEADER,
} from "../src/common/logging/correlation-id.middleware";
import { HttpMetricsMiddleware } from "../src/common/metrics/http-metrics.middleware";

describe("CorrelationIdMiddleware", () => {
  it("keeps an incoming correlation id", () => {
    const middleware = new CorrelationIdMiddleware();
    const request = {
      header: (name: string) =>
        name === CORRELATION_ID_HEADER ? "incoming-id" : undefined,
    } as Request;
    const response = {
      setHeader: jest.fn(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(request, response, next);

    expect(request.correlationId).toBe("incoming-id");
    expect(response.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      "incoming-id",
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("creates a correlation id when none is provided", () => {
    const middleware = new CorrelationIdMiddleware();
    const request = {
      header: () => undefined,
    } as unknown as Request;
    const response = {
      setHeader: jest.fn(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(request, response, next);

    expect(request.correlationId).toEqual(expect.any(String));
    expect(response.setHeader).toHaveBeenCalledWith(
      CORRELATION_ID_HEADER,
      request.correlationId,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("HttpMetricsMiddleware", () => {
  it("records request metrics after the response finishes", () => {
    const middleware = new HttpMetricsMiddleware();
    const callbacks: Record<string, () => void> = {};
    const request = {
      method: "GET",
      path: "/health",
      route: {
        path: "/health",
      },
    } as Request;
    const response = {
      statusCode: 200,
      on: jest.fn((event: string, callback: () => void) => {
        callbacks[event] = callback;
        return response;
      }),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(request, response, next);
    callbacks.finish();

    expect(response.on).toHaveBeenCalledWith("finish", expect.any(Function));
    expect(next).toHaveBeenCalledTimes(1);
  });
});
