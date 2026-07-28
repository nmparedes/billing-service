import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BudgetStatus } from "../../domain/enums/budget-status.enum";

class BudgetServiceItemResponseDto {
  @ApiProperty() serviceId!: string;
  @ApiProperty() serviceName!: string;
  @ApiProperty() unitPrice!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() subtotal!: number;
}

class BudgetPartItemResponseDto {
  @ApiProperty() partId!: string;
  @ApiProperty() partCode!: string;
  @ApiProperty() partName!: string;
  @ApiProperty() unitPrice!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() subtotal!: number;
}

export class BudgetResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() sagaId!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty() customerId!: string;
  @ApiProperty() customerDocument!: string;
  @ApiProperty() customerName!: string;
  @ApiPropertyOptional() vehicleId?: string;
  @ApiPropertyOptional() vehiclePlate?: string;
  @ApiPropertyOptional() vehicleBrand?: string;
  @ApiPropertyOptional() vehicleModel?: string;
  @ApiPropertyOptional() vehicleYear?: number;
  @ApiProperty({ enum: BudgetStatus }) status!: BudgetStatus;
  @ApiProperty({ type: [BudgetServiceItemResponseDto] })
  serviceItems!: BudgetServiceItemResponseDto[];
  @ApiProperty({ type: [BudgetPartItemResponseDto] })
  partItems!: BudgetPartItemResponseDto[];
  @ApiProperty() serviceSubtotal!: number;
  @ApiProperty() partSubtotal!: number;
  @ApiProperty() totalAmount!: number;
  @ApiProperty() requestedAt!: Date;
  @ApiPropertyOptional() createdAt?: Date;
  @ApiPropertyOptional() approvalRequestedAt?: Date;
  @ApiPropertyOptional() approvedAt?: Date;
  @ApiPropertyOptional() rejectedAt?: Date;
  @ApiProperty() expiresAt!: Date;
  @ApiPropertyOptional() rejectionReason?: string;
}
