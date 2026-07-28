import { ConfigService } from "@nestjs/config";
import {
  createMongoClient,
  DatabaseModule,
} from "../../src/database/database.module";

describe("DatabaseModule", () => {
  it("defines MongoDB ownership for billing-service", () => {
    expect(DatabaseModule).toBeDefined();
  });

  it("creates a client from externally configured MongoDB settings", async () => {
    const client = createMongoClient(
      new ConfigService({
        MONGODB_URI: "mongodb://localhost:27017/billing-test",
        MONGODB_SERVER_SELECTION_TIMEOUT_MS: 1500,
      }),
    );

    expect(client.options.serverSelectionTimeoutMS).toBe(1500);
    await client.close();
  });
});
