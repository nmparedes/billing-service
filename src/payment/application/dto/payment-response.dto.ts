import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaymentStatus } from "../../domain/enums/payment-status.enum";

export class PaymentResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;
  @ApiProperty({ format: "uuid" })
  budgetId!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() sagaId!: string;
  @ApiProperty() externalReference!: string;
  @ApiProperty({ example: 400 }) amount!: number;
  @ApiProperty({ example: "BRL" }) currency!: "BRL";
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiPropertyOptional() providerPreferenceId?: string;
  @ApiPropertyOptional() providerPaymentId?: string;
  @ApiPropertyOptional() providerStatus?: string;
  @ApiPropertyOptional({ format: "uri" }) checkoutUrl?: string;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional() approvedAt?: Date;
  @ApiPropertyOptional() failedAt?: Date;
  @ApiProperty() updatedAt!: Date;
}
