import { Injectable } from "@nestjs/common";
import {
  MercadoPagoConfig,
  Payment as MercadoPagoPayment,
  PaymentRefund,
  Preference,
} from "mercadopago";
import type {
  CreatePreferenceInput,
  CreatePreferenceResult,
  PaymentProvider,
  ProviderPaymentResult,
  ProviderRefundResult,
  RefundPaymentInput,
} from "../../domain/providers/payment-provider.interface";
import { MercadoPagoConfigurationService } from "../config/mercado-pago-configuration.service";
import { incrementIntegrationFailureMetric } from "../../../common/metrics/metrics.registry";

@Injectable()
export class MercadoPagoCheckoutProClient implements PaymentProvider {
  private readonly preference: Preference;
  private readonly payment: MercadoPagoPayment;
  private readonly paymentRefund: PaymentRefund;
  private readonly isProduction: boolean;

  constructor(configurationService: MercadoPagoConfigurationService) {
    const configuration = configurationService.getActiveConfiguration();
    const client = new MercadoPagoConfig({
      accessToken: configuration.accessToken,
    });
    this.preference = new Preference(client);
    this.payment = new MercadoPagoPayment(client);
    this.paymentRefund = new PaymentRefund(client);
    this.isProduction = configuration.environment === "production";
  }

  async createPreference(
    input: CreatePreferenceInput,
  ): Promise<CreatePreferenceResult> {
    try {
      const preference = await this.preference.create({
        body: {
          external_reference: input.externalReference,
          notification_url: input.notificationUrl,
          back_urls: input.backUrls,
          auto_return: "approved",
          items: [
            {
              id: input.externalReference,
              title: input.title,
              quantity: 1,
              currency_id: input.currency,
              unit_price: input.amount,
            },
          ],
        },
      });
      const checkoutUrl = this.isProduction
        ? preference.init_point
        : (preference.sandbox_init_point ?? preference.init_point);

      if (!preference.id || !checkoutUrl) {
        throw new Error(
          "Mercado Pago preference response omitted an ID or checkout URL.",
        );
      }

      return {
        providerPreferenceId: preference.id,
        checkoutUrl,
      };
    } catch (error) {
      incrementIntegrationFailureMetric("mercado_pago");
      throw error;
    }
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPaymentResult> {
    try {
      const payment = await this.payment.get({ id: providerPaymentId });
      if (!payment.id || !payment.status) {
        throw new Error(
          "Mercado Pago payment response omitted an ID or status.",
        );
      }
      return {
        providerPaymentId: String(payment.id),
        status: payment.status,
        externalReference: payment.external_reference,
      };
    } catch (error) {
      incrementIntegrationFailureMetric("mercado_pago");
      throw error;
    }
  }

  async refundPayment(
    input: RefundPaymentInput,
  ): Promise<ProviderRefundResult> {
    try {
      const refund = await this.paymentRefund.total({
        payment_id: input.providerPaymentId,
        requestOptions: { idempotencyKey: input.idempotencyKey },
      });
      if (!refund.id || !refund.status) {
        throw new Error(
          "Mercado Pago refund response omitted an ID or status.",
        );
      }
      if (refund.status !== "approved" && refund.status !== "refunded") {
        throw new Error("Mercado Pago returned an unsupported refund status.");
      }
      return {
        providerRefundId: String(refund.id),
        status: "COMPLETED",
      };
    } catch (error) {
      incrementIntegrationFailureMetric("mercado_pago");
      throw error;
    }
  }
}
