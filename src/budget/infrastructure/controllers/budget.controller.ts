import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { BudgetResponseDto } from "../../application/dto/budget-response.dto";
import { CreateBudgetDto } from "../../application/dto/create-budget.dto";
import { ListBudgetsQueryDto } from "../../application/dto/list-budgets.query.dto";
import { RejectBudgetDto } from "../../application/dto/reject-budget.dto";
import { BudgetService } from "../../application/services/budget.service";
import { BillingEventsService } from "../../../messaging/billing-events.service";
import { PaginatedResponse } from "../../../common/interfaces/paginated-response.interface";

@ApiTags("budgets")
@ApiBearerAuth()
@Controller("budgets")
export class BudgetController {
  constructor(
    private readonly budgetService: BudgetService,
    private readonly billingEvents: BillingEventsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: "Create an idempotent budget from order snapshots.",
  })
  @ApiCreatedResponse({ type: BudgetResponseDto })
  create(@Body() dto: CreateBudgetDto): Promise<BudgetResponseDto> {
    return this.budgetService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "List budgets with optional filters." })
  @ApiOkResponse({ description: "Paginated budgets list." })
  findAll(
    @Query() query: ListBudgetsQueryDto,
  ): Promise<PaginatedResponse<BudgetResponseDto>> {
    return this.budgetService.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a budget by ID." })
  @ApiParam({ name: "id" })
  @ApiOkResponse({ type: BudgetResponseDto })
  findById(@Param("id") id: string): Promise<BudgetResponseDto> {
    return this.budgetService.findById(id);
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Approve a budget that is waiting for approval." })
  @ApiParam({ name: "id" })
  @ApiOkResponse({ type: BudgetResponseDto })
  async approve(@Param("id") id: string): Promise<BudgetResponseDto> {
    const result = await this.budgetService.approveForPublication(id);
    await this.billingEvents.publishBudgetApproved(result.budget, id);
    return result.budget;
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reject a budget that is waiting for approval." })
  @ApiParam({ name: "id" })
  @ApiOkResponse({ type: BudgetResponseDto })
  async reject(
    @Param("id") id: string,
    @Body() dto: RejectBudgetDto,
  ): Promise<BudgetResponseDto> {
    const result = await this.budgetService.rejectForPublication(id, dto);
    await this.billingEvents.publishBudgetRejected(result.budget, id);
    return result.budget;
  }
}
