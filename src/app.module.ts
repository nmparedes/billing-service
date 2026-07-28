import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { validateEnvironment } from "./common/config/environment.validation";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { BudgetModule } from "./budget/budget.module";
import { PaymentModule } from "./payment/payment.module";
import { MessagingModule } from "./messaging/rabbitmq-broker";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    BudgetModule,
    PaymentModule,
    MessagingModule,
  ],
})
export class AppModule {}
