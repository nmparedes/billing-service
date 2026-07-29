import { MercadoPagoWebhookController } from "../../src/payment/infrastructure/controllers/mercado-pago-webhook.controller";
import { PaymentWebhookService } from "../../src/payment/application/services/payment-webhook.service";

describe("MercadoPagoWebhookController", () => {
  it("delegates a public Mercado Pago notification to the webhook service", async () => {
    const paymentWebhookService = {
      handle: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PaymentWebhookService>;
    const controller = new MercadoPagoWebhookController(paymentWebhookService);
    const payload = {
      id: "notification-1",
      action: "payment.updated",
      type: "payment" as const,
      data: { id: "provider-payment-1" },
    };

    await expect(
      controller.handle(
        "ts=1710000000,v1=signature",
        "request-1",
        "payment",
        undefined,
        "provider-payment-1",
        undefined,
        payload,
      ),
    ).resolves.toBeUndefined();

    expect(paymentWebhookService.handle).toHaveBeenCalledWith({
      signature: "ts=1710000000,v1=signature",
      requestId: "request-1",
      type: "payment",
      providerNotificationId: "notification-1",
      providerPaymentId: "provider-payment-1",
      action: "payment.updated",
      rawPayload: payload,
    });
  });

  it("normalizes a query-only payment webhook", async () => {
    const paymentWebhookService = {
      handle: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PaymentWebhookService>;
    const controller = new MercadoPagoWebhookController(paymentWebhookService);

    await expect(
      controller.handle(
        "ts=1710000000,v1=signature",
        "request-2",
        undefined,
        "payment",
        undefined,
        "provider-payment-2",
        {},
      ),
    ).resolves.toBeUndefined();

    expect(paymentWebhookService.handle).toHaveBeenCalledWith({
      signature: "ts=1710000000,v1=signature",
      requestId: "request-2",
      type: "payment",
      providerNotificationId: "request-2",
      providerPaymentId: "provider-payment-2",
      action: "payment.updated",
      rawPayload: {},
    });
  });

  it("ignores unsupported webhook topics", async () => {
    const paymentWebhookService = {
      handle: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PaymentWebhookService>;
    const controller = new MercadoPagoWebhookController(paymentWebhookService);

    await expect(
      controller.handle(
        undefined,
        "request-3",
        undefined,
        "merchant_order",
        undefined,
        "merchant-order-1",
        {},
      ),
    ).resolves.toBeUndefined();

    expect(paymentWebhookService.handle).not.toHaveBeenCalled();
  });
});
