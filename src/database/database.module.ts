import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongoClient } from "mongodb";
import { MONGO_CLIENT } from "./database.constants";

export function createMongoClient(configService: ConfigService): MongoClient {
  return new MongoClient(configService.getOrThrow<string>("MONGODB_URI"), {
    serverSelectionTimeoutMS: configService.get<number>(
      "MONGODB_SERVER_SELECTION_TIMEOUT_MS",
      5000,
    ),
  });
}

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MONGO_CLIENT,
      inject: [ConfigService],
      useFactory: createMongoClient,
    },
  ],
  exports: [MONGO_CLIENT],
})
export class DatabaseModule {}
