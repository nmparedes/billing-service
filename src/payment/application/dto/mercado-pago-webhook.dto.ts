import { Type } from "class-transformer";
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  ValidateNested,
} from "class-validator";

export class MercadoPagoWebhookDataDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class MercadoPagoWebhookDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  action!: string;

  @IsIn(["payment"])
  type!: "payment";

  @IsObject()
  @ValidateNested()
  @Type(() => MercadoPagoWebhookDataDto)
  data!: MercadoPagoWebhookDataDto;
}
