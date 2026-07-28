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
import { PaymentWebhookService } from "../../application/services/payment-webhook.service";

@ApiTags("payment-webhooks")
@Controller("webhooks/mercado-pago")
export class MercadoPagoWebhookController {
  constructor(private readonly paymentWebhookService: PaymentWebhookService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Receive a signed Mercado Pago Payments webhook." })
  @ApiHeader({ name: "x-signature", required: true })
  @ApiHeader({ name: "x-request-id", required: true })
  @ApiQuery({ name: "type", required: true, enum: ["payment"] })
  @ApiQuery({ name: "data.id", required: true })
  @ApiBody({ type: MercadoPagoWebhookDto })
  @ApiOkResponse({
    description: "Webhook was processed or was already processed.",
  })
  async handle(
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
    @Query("type") type: string | undefined,
    @Query("data.id") queryDataId: string | undefined,
    @Body() payload: MercadoPagoWebhookDto,
  ): Promise<void> {
    await this.paymentWebhookService.handle({
      signature,
      requestId,
      type,
      queryDataId,
      payload,
    });
  }
}
