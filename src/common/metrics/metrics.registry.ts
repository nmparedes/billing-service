import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from "prom-client";

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds.",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

const SERVICE_NAME = "billing-service";

export const integrationFailuresTotal = new Counter({
  name: "integration_failures_total",
  help: "Total number of confirmed technical integration failures.",
  labelNames: ["service", "integration"],
  registers: [metricsRegistry],
});

export function incrementIntegrationFailureMetric(integration: string): void {
  integrationFailuresTotal.inc({
    service: SERVICE_NAME,
    integration,
  });
}
