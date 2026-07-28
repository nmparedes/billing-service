import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class CreatePaymentDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  budgetId!: string;
}
