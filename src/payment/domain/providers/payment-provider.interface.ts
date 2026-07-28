export interface CreatePreferenceInput {
  externalReference: string;
  title: string;
  amount: number;
  currency: "BRL";
  notificationUrl: string;
  backUrls: {
    success: string;
    failure: string;
    pending: string;
  };
}

export interface CreatePreferenceResult {
  providerPreferenceId: string;
  checkoutUrl: string;
}

export interface ProviderPaymentResult {
  providerPaymentId: string;
  status: string;
  externalReference?: string;
}
export interface RefundPaymentInput {
  providerPaymentId: string;
  idempotencyKey: string;
}
export interface ProviderRefundResult {
  providerRefundId: string;
  status: "COMPLETED";
}

export interface PaymentProvider {
  createPreference(
    input: CreatePreferenceInput,
  ): Promise<CreatePreferenceResult>;
  getPayment(providerPaymentId: string): Promise<ProviderPaymentResult>;
  refundPayment(input: RefundPaymentInput): Promise<ProviderRefundResult>;
}
