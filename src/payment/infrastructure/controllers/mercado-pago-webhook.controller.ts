import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Public } from "../../../auth/decorators/public.decorator";
import { MercadoPagoWebhookDto } from "../../application/dto/mercado-pago-webhook.dto";
import {
  PaymentWebhookService,
  HandleMercadoPagoWebhookInput,
} from "../../application/services/payment-webhook.service";

@ApiTags("payment-webhooks")
@Controller("webhooks/mercado-pago")
export class MercadoPagoWebhookController {
  constructor(private readonly paymentWebhookService: PaymentWebhookService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Receive a signed Mercado Pago Payments webhook." })
  @ApiHeader({ name: "x-signature", required: false })
  @ApiHeader({ name: "x-request-id", required: false })
  @ApiQuery({ name: "type", required: false, enum: ["payment"] })
  @ApiQuery({ name: "data.id", required: false })
  @ApiQuery({ name: "topic", required: false, enum: ["payment", "merchant_order"] })
  @ApiQuery({ name: "id", required: false })
  @ApiBody({ type: MercadoPagoWebhookDto })
  @ApiOkResponse({
    description: "Webhook was processed, ignored or was already processed.",
  })
  async handle(
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
    @Query("type") type: string | undefined,
    @Query("topic") topic: string | undefined,
    @Query("data.id") queryDataId: string | undefined,
    @Query("id") queryId: string | undefined,
    @Body() payload?: Partial<MercadoPagoWebhookDto> | Record<string, unknown>,
  ): Promise<void> {
    const normalized = this.normalizeWebhook({
      signature,
      requestId,
      type,
      topic,
      queryDataId,
      queryId,
      payload,
    });

    if (!normalized) {
      return;
    }

    await this.paymentWebhookService.handle(normalized);
  }

  private normalizeWebhook(input: {
    signature?: string;
    requestId?: string;
    type?: string;
    topic?: string;
    queryDataId?: string;
    queryId?: string;
    payload?: Partial<MercadoPagoWebhookDto> | Record<string, unknown>;
  }): HandleMercadoPagoWebhookInput | null {
    const payload =
      input.payload && typeof input.payload === "object" ? input.payload : {};
    const normalizedType =
      input.type ?? input.topic ?? ("type" in payload ? String(payload.type) : undefined);

    if (normalizedType !== "payment") {
      return null;
    }

    const payloadData =
      "data" in payload && payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : undefined;
    const providerPaymentId =
      input.queryDataId ??
      (typeof payloadData?.id === "string" ? payloadData.id : undefined) ??
      (input.topic === "payment" ? input.queryId : undefined);
    const providerNotificationId =
      ("id" in payload && typeof payload.id === "string" ? payload.id : undefined) ??
      input.requestId ??
      providerPaymentId;
    const action =
      ("action" in payload && typeof payload.action === "string"
        ? payload.action
        : undefined) ?? "payment.updated";

    return {
      signature: input.signature,
      requestId: input.requestId,
      type: normalizedType,
      providerNotificationId,
      providerPaymentId,
      action,
      usesLegacyTopicQueryFormat:
        input.type === undefined &&
        input.topic === "payment" &&
        input.queryDataId === undefined &&
        input.queryId !== undefined,
      rawPayload: payload as Record<string, unknown>,
    };
  }
}
