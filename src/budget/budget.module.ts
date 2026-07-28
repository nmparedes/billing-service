import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { MessagingModule } from "../messaging/rabbitmq-broker";
import { BillingEventsService } from "../messaging/billing-events.service";
import { MongoConsumedMessageRepository } from "../messaging/consumed-message.repository";
import { BudgetService } from "./application/services/budget.service";
import { BUDGET_REPOSITORY } from "./budget.tokens";
import { BudgetController } from "./infrastructure/controllers/budget.controller";
import { MongoBudgetRepository } from "./infrastructure/repositories/mongo-budget.repository";

@Module({
  imports: [DatabaseModule, MessagingModule],
  controllers: [BudgetController],
  providers: [
    BudgetService,
    BillingEventsService,
    MongoConsumedMessageRepository,
    MongoBudgetRepository,
    {
      provide: BUDGET_REPOSITORY,
      useExisting: MongoBudgetRepository,
    },
  ],
  exports: [BudgetService, BillingEventsService, BUDGET_REPOSITORY],
})
export class BudgetModule {}
