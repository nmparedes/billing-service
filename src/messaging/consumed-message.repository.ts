import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { Collection, MongoClient } from "mongodb";
import { MONGO_CLIENT } from "../database/database.constants";

type ConsumedMessageStatus = "PROCESSING" | "PROCESSED" | "FAILED";

export interface ConsumedMessageClaim {
  token: string;
}

interface ConsumedMessageDocument {
  _id: string;
  consumerName: string;
  eventId: string;
  status: ConsumedMessageStatus;
  claimToken?: string | null;
  processingStartedAt?: Date | null;
  leaseExpiresAt?: Date | null;
  createdAt: Date;
  processedAt?: Date;
  updatedAt: Date;
}

@Injectable()
export class MongoConsumedMessageRepository {
  constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    private readonly configService: ConfigService,
  ) {}

  async claim(
    consumerName: string,
    eventId: string,
  ): Promise<ConsumedMessageClaim | null> {
    const collection = await this.collection();
    const now = new Date();
    const claimToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs());
    try {
      await collection.insertOne({
        _id: `${consumerName}:${eventId}`,
        consumerName,
        eventId,
        status: "PROCESSING",
        claimToken,
        processingStartedAt: now,
        leaseExpiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return { token: claimToken };
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) throw error;
    }

    const existing = await collection.findOne({ consumerName, eventId });
    if (!existing) {
      throw new Error("Consumed message was not found after a duplicate key.");
    }
    if (existing.status === "PROCESSED") return null;
    if (
      existing.status === "PROCESSING" &&
      existing.leaseExpiresAt &&
      existing.leaseExpiresAt > now
    ) {
      throw new Error("Consumed message is already processing.");
    }

    const retried = await collection.findOneAndUpdate(
      {
        consumerName,
        eventId,
        $or: [
          { status: "FAILED" },
          { status: "PROCESSING", leaseExpiresAt: { $lte: now } },
          { status: "PROCESSING", leaseExpiresAt: null },
          { status: "PROCESSING", leaseExpiresAt: { $exists: false } },
        ],
      },
      {
        $set: {
          status: "PROCESSING",
          claimToken,
          processingStartedAt: now,
          leaseExpiresAt,
          updatedAt: now,
        },
        $unset: { processedAt: "" },
      },
      { returnDocument: "after" },
    );
    if (!retried) throw new Error("Consumed message is already processing.");
    return { token: claimToken };
  }

  async markProcessed(
    consumerName: string,
    eventId: string,
    claimToken: string,
  ): Promise<void> {
    const result = await (
      await this.collection()
    ).updateOne(
      { consumerName, eventId, status: "PROCESSING", claimToken },
      {
        $set: {
          status: "PROCESSED",
          processedAt: new Date(),
          updatedAt: new Date(),
        },
        $unset: { claimToken: "", processingStartedAt: "", leaseExpiresAt: "" },
      },
    );
    if (result.matchedCount !== 1) {
      throw new Error("Consumed message claim was lost before completion.");
    }
  }

  async markFailed(
    consumerName: string,
    eventId: string,
    claimToken: string,
  ): Promise<void> {
    const result = await (
      await this.collection()
    ).updateOne(
      { consumerName, eventId, status: "PROCESSING", claimToken },
      {
        $set: { status: "FAILED", updatedAt: new Date() },
        $unset: { claimToken: "", processingStartedAt: "", leaseExpiresAt: "" },
      },
    );
    if (result.matchedCount !== 1) {
      throw new Error("Consumed message claim was lost before failure.");
    }
  }

  private leaseDurationMs(): number {
    return this.configService.get<number>("CONSUMED_MESSAGE_LEASE_MS", 300000);
  }

  private async collection(): Promise<Collection<ConsumedMessageDocument>> {
    const collection = this.client
      .db()
      .collection<ConsumedMessageDocument>("consumed_messages");
    await collection.createIndex(
      { consumerName: 1, eventId: 1 },
      { unique: true, name: "consumed_message_consumer_event_unique" },
    );
    return collection;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
