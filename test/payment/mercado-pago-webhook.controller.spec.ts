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
        "provider-payment-1",
        payload,
      ),
    ).resolves.toBeUndefined();

    expect(paymentWebhookService.handle).toHaveBeenCalledWith({
      signature: "ts=1710000000,v1=signature",
      requestId: "request-1",
      type: "payment",
      queryDataId: "provider-payment-1",
      payload,
    });
  });
});
