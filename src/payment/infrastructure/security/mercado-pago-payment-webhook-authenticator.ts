import { Injectable } from "@nestjs/common";
import { PaymentWebhookAuthenticator } from "../../application/ports/payment-webhook-authenticator.interface";
import { MercadoPagoConfigurationService } from "../config/mercado-pago-configuration.service";
import { MercadoPagoWebhookSignatureValidator } from "./mercado-pago-webhook-signature.validator";

@Injectable()
export class MercadoPagoPaymentWebhookAuthenticator implements PaymentWebhookAuthenticator {
  constructor(
    private readonly validator: MercadoPagoWebhookSignatureValidator,
    private readonly configuration: MercadoPagoConfigurationService,
  ) {}

  validate(input: {
    signature?: string;
    requestId?: string;
    dataId?: string;
    allowLegacyTestFallback?: boolean;
  }): boolean {
    const configuration = this.configuration.getActiveConfiguration();

    if (
      input.allowLegacyTestFallback &&
      configuration.environment === "test"
    ) {
      return true;
    }

    return this.validator.validate({
      signature: input.signature,
      requestId: input.requestId,
      dataId: input.dataId,
      secret: configuration.webhookSecret,
    });
  }
}
