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
  }): boolean {
    return this.validator.validate({
      ...input,
      secret: this.configuration.getActiveConfiguration().webhookSecret,
    });
  }
}
