import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class RejectBudgetDto {
  @ApiPropertyOptional({
    example: "The customer declined the proposed amount.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
