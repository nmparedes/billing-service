import {
  MercadoPagoConfig,
  Payment as MercadoPagoPayment,
  PaymentRefund,
  Preference,
} from "mercadopago";
import {
  integrationFailuresTotal,
  metricsRegistry,
} from "../../src/common/metrics/metrics.registry";
import { MercadoPagoCheckoutProClient } from "../../src/payment/infrastructure/clients/mercado-pago-checkout-pro.client";
import { MercadoPagoConfigurationService } from "../../src/payment/infrastructure/config/mercado-pago-configuration.service";

jest.mock("mercadopago", () => ({
  MercadoPagoConfig: jest.fn(),
  Payment: jest.fn(),
  PaymentRefund: jest.fn(),
  Preference: jest.fn(),
}));

describe("MercadoPagoCheckoutProClient", () => {
  const preferenceCreate = jest.fn();
  const paymentGet = jest.fn();
  const paymentRefundTotal = jest.fn();

  beforeEach(() => {
    metricsRegistry.resetMetrics();
    jest.clearAllMocks();
    (Preference as unknown as jest.Mock).mockImplementation(() => ({
      create: preferenceCreate,
    }));
    (MercadoPagoPayment as unknown as jest.Mock).mockImplementation(() => ({
      get: paymentGet,
    }));
    (PaymentRefund as unknown as jest.Mock).mockImplementation(() => ({
      total: paymentRefundTotal,
    }));
  });

  it("creates a sandbox Checkout Pro preference through the SDK", async () => {
    preferenceCreate.mockResolvedValue({
      id: "preference-1",
      init_point: "https://www.mercadopago.com/checkout/preference-1",
      sandbox_init_point:
        "https://sandbox.mercadopago.com/checkout/preference-1",
    });
    const client = new MercadoPagoCheckoutProClient(configuration("test"));

    await expect(
      client.createPreference({
        externalReference: "payment-1",
        title: "Service order OS-1",
        amount: 400,
        currency: "BRL",
        notificationUrl: "https://example.test/webhooks/mercado-pago",
        backUrls: {
          success: "https://example.test/payments/success",
          failure: "https://example.test/payments/failure",
          pending: "https://example.test/payments/pending",
        },
      }),
    ).resolves.toEqual({
      providerPreferenceId: "preference-1",
      checkoutUrl: "https://sandbox.mercadopago.com/checkout/preference-1",
    });

    expect(MercadoPagoConfig).toHaveBeenCalledWith({
      accessToken: "test-access-token",
    });
    expect(preferenceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          external_reference: "payment-1",
          notification_url: "https://example.test/webhooks/mercado-pago",
        }),
      }),
    );
  });

  it("uses the production URL and maps provider payment lookups", async () => {
    preferenceCreate.mockResolvedValue({
      id: "preference-1",
      init_point: "https://www.mercadopago.com/checkout/preference-1",
    });
    paymentGet.mockResolvedValue({
      id: 123,
      status: "approved",
      external_reference: "payment-1",
    });
    const client = new MercadoPagoCheckoutProClient(
      configuration("production"),
    );

    await expect(
      client.createPreference({
        externalReference: "payment-1",
        title: "Service order OS-1",
        amount: 400,
        currency: "BRL",
        notificationUrl: "https://example.test/webhooks/mercado-pago",
        backUrls: {
          success: "https://example.test/payments/success",
          failure: "https://example.test/payments/failure",
          pending: "https://example.test/payments/pending",
        },
      }),
    ).resolves.toMatchObject({
      checkoutUrl: "https://www.mercadopago.com/checkout/preference-1",
    });
    await expect(client.getPayment("123")).resolves.toEqual({
      providerPaymentId: "123",
      status: "approved",
      externalReference: "payment-1",
    });
  });

  it("creates a total refund with the official idempotency option", async () => {
    paymentRefundTotal.mockResolvedValue({
      id: 456,
      status: "approved",
    });
    const client = new MercadoPagoCheckoutProClient(configuration("test"));

    await expect(
      client.refundPayment({
        providerPaymentId: "123",
        idempotencyKey: "stable-key",
      }),
    ).resolves.toEqual({
      providerRefundId: "456",
      status: "COMPLETED",
    });
    expect(paymentRefundTotal).toHaveBeenCalledWith({
      payment_id: "123",
      requestOptions: { idempotencyKey: "stable-key" },
    });
    expect(paymentRefundTotal.mock.calls[0][0]).not.toHaveProperty("amount");
  });

  it("rejects unknown refund statuses without casting them", async () => {
    paymentRefundTotal.mockResolvedValue({ id: 456, status: "processing" });
    const client = new MercadoPagoCheckoutProClient(configuration("test"));

    await expect(
      client.refundPayment({
        providerPaymentId: "123",
        idempotencyKey: "stable-key",
      }),
    ).rejects.toThrow("unsupported refund status");
    await expect(integrationFailuresTotal.get()).resolves.toMatchObject({
      values: [
        expect.objectContaining({
          labels: { service: "billing-service", integration: "mercado_pago" },
          value: 1,
        }),
      ],
    });
  });

  it("falls back to init point outside production and rejects incomplete responses", async () => {
    preferenceCreate.mockResolvedValue({
      id: "preference-1",
      init_point: "https://www.mercadopago.com/checkout/preference-1",
    });
    paymentGet.mockResolvedValue({ id: 123 });
    const client = new MercadoPagoCheckoutProClient(configuration("test"));
    const input = {
      externalReference: "payment-1",
      title: "Service order OS-1",
      amount: 400,
      currency: "BRL" as const,
      notificationUrl: "https://example.test/webhooks/mercado-pago",
      backUrls: {
        success: "https://example.test/payments/success",
        failure: "https://example.test/payments/failure",
        pending: "https://example.test/payments/pending",
      },
    };

    await expect(client.createPreference(input)).resolves.toMatchObject({
      checkoutUrl: "https://www.mercadopago.com/checkout/preference-1",
    });
    await expect(client.getPayment("123")).rejects.toThrow(
      "omitted an ID or status",
    );

    preferenceCreate.mockResolvedValue({});
    await expect(client.createPreference(input)).rejects.toThrow(
      "omitted an ID or checkout URL",
    );
  });
});

function configuration(
  environment: "test" | "production",
): MercadoPagoConfigurationService {
  return {
    getActiveConfiguration: () => ({
      environment,
      accessToken:
        environment === "test"
          ? "test-access-token"
          : "production-access-token",
      webhookSecret:
        environment === "test"
          ? "test-webhook-secret"
          : "production-webhook-secret",
    }),
  } as MercadoPagoConfigurationService;
}
