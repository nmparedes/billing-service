import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

class CustomerSnapshotDto {
  @ApiProperty() @IsString() @IsNotEmpty() customerId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() customerDocument!: string;
  @ApiProperty() @IsString() @IsNotEmpty() customerName!: string;
}

class VehicleSnapshotDto {
  @ApiProperty() @IsString() @IsNotEmpty() vehicleId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() vehiclePlate!: string;
  @ApiProperty() @IsString() @IsNotEmpty() vehicleBrand!: string;
  @ApiProperty() @IsString() @IsNotEmpty() vehicleModel!: string;
  @ApiProperty() @IsInt() @Min(1886) vehicleYear!: number;
}

class ServiceItemSnapshotDto {
  @ApiProperty() @IsString() @IsNotEmpty() serviceId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() serviceName!: string;
  @ApiProperty({ example: 150 }) @IsNumber() @Min(0) unitPrice!: number;
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) quantity!: number;
}

class PartItemSnapshotDto {
  @ApiProperty() @IsString() @IsNotEmpty() partId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() partCode!: string;
  @ApiProperty() @IsString() @IsNotEmpty() partName!: string;
  @ApiProperty({ example: 50 }) @IsNumber() @Min(0) unitPrice!: number;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) quantity!: number;
}

export class CreateBudgetDto {
  @ApiProperty() @IsString() @IsNotEmpty() sagaId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() orderId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() orderNumber!: string;

  @ApiProperty({ type: CustomerSnapshotDto })
  @ValidateNested()
  @Type(() => CustomerSnapshotDto)
  customer!: CustomerSnapshotDto;

  @ApiPropertyOptional({ type: VehicleSnapshotDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => VehicleSnapshotDto)
  vehicle?: VehicleSnapshotDto;

  @ApiProperty({ type: [ServiceItemSnapshotDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceItemSnapshotDto)
  serviceItems: ServiceItemSnapshotDto[] = [];

  @ApiProperty({ type: [PartItemSnapshotDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartItemSnapshotDto)
  partItems: PartItemSnapshotDto[] = [];

  @ApiPropertyOptional({
    description: "Budget validity in days.",
    minimum: 1,
    maximum: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  validityDays?: number;
}
