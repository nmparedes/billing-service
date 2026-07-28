export interface PaymentWebhookAuthenticator {
  validate(input: {
    signature?: string;
    requestId?: string;
    dataId?: string;
  }): boolean;
}

export const PAYMENT_WEBHOOK_AUTHENTICATOR = Symbol(
  "PAYMENT_WEBHOOK_AUTHENTICATOR",
);
