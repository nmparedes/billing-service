import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { CreatePaymentDto } from "../../application/dto/create-payment.dto";
import { PaymentResponseDto } from "../../application/dto/payment-response.dto";
import { PaymentService } from "../../application/services/payment.service";
import { BillingEventsService } from "../../../messaging/billing-events.service";

@ApiTags("payments")
@ApiBearerAuth()
@Controller("payments")
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly billingEvents: BillingEventsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: "Create or reuse a Checkout Pro payment for an approved budget.",
  })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  async create(@Body() dto: CreatePaymentDto): Promise<PaymentResponseDto> {
    const result = await this.paymentService.createWithResult(dto);
    await this.billingEvents.publishPaymentCreated(
      result.payment,
      dto.budgetId,
    );
    return result.payment;
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a local payment by ID." })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: PaymentResponseDto })
  findById(@Param("id") id: string): Promise<PaymentResponseDto> {
    return this.paymentService.findById(id);
  }
}
