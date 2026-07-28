import { createHmac } from "crypto";
import { WebhookSignatureValidator } from "mercadopago";
import { MercadoPagoWebhookSignatureValidator } from "../../src/payment/infrastructure/security/mercado-pago-webhook-signature.validator";

describe("MercadoPagoWebhookSignatureValidator", () => {
  const secret = "test-webhook-secret";
  const requestId = "request-1";
  const dataId = "provider-payment-1";

  it("accepts the official Mercado Pago HMAC manifest", () => {
    const validator = new MercadoPagoWebhookSignatureValidator();
    const validate = jest.spyOn(WebhookSignatureValidator, "validate");

    expect(
      validator.validate({
        signature: signatureFor(secret, requestId, dataId),
        requestId,
        dataId,
        secret,
      }),
    ).toBe(true);
    expect(validate).toHaveBeenCalledWith({
      xSignature: signatureFor(secret, requestId, dataId),
      xRequestId: requestId,
      dataId,
      secret,
    });
    validate.mockRestore();
  });

  it("rejects malformed, missing, and invalid signature inputs through the SDK", () => {
    const validator = new MercadoPagoWebhookSignatureValidator();

    expect(
      validator.validate({
        signature: "ts=123,v1=invalid",
        requestId,
        dataId,
        secret,
      }),
    ).toBe(false);
    expect(validator.validate({ requestId, dataId, secret })).toBe(false);
    expect(
      validator.validate({
        signature: signatureFor(secret, requestId, dataId),
        dataId,
        secret,
      }),
    ).toBe(false);
    expect(
      validator.validate({
        signature: signatureFor(secret, requestId, dataId),
        requestId,
        secret,
      }),
    ).toBe(false);
    expect(
      validator.validate({
        signature: signatureFor(secret, requestId, dataId),
        requestId,
        dataId,
        secret: "",
      }),
    ).toBe(false);
  });

  it("preserves unexpected SDK failures", () => {
    const validator = new MercadoPagoWebhookSignatureValidator();
    const validate = jest
      .spyOn(WebhookSignatureValidator, "validate")
      .mockImplementationOnce(() => {
        throw new Error("SDK unavailable");
      });

    expect(() =>
      validator.validate({
        signature: signatureFor(secret, requestId, dataId),
        requestId,
        dataId,
        secret,
      }),
    ).toThrow("SDK unavailable");
    validate.mockRestore();
  });
});

export function signatureFor(
  secret: string,
  requestId: string,
  dataId: string,
  timestamp = "1710000000",
): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const signature = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${timestamp},v1=${signature}`;
}
