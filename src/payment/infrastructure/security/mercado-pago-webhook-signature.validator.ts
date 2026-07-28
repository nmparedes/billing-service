import { Injectable } from "@nestjs/common";
import {
  InvalidWebhookSignatureError,
  WebhookSignatureValidator,
} from "mercadopago";

export interface MercadoPagoWebhookSignatureInput {
  signature?: string;
  requestId?: string;
  dataId?: string;
  secret: string;
}

@Injectable()
export class MercadoPagoWebhookSignatureValidator {
  validate(input: MercadoPagoWebhookSignatureInput): boolean {
    if (!input.secret) {
      return false;
    }

    try {
      WebhookSignatureValidator.validate({
        xSignature: input.signature,
        xRequestId: input.requestId,
        dataId: input.dataId,
        secret: input.secret,
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof InvalidWebhookSignatureError) {
        return false;
      }
      throw error;
    }
  }
}
