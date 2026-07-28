import { MongoClient } from "mongodb";
import { MongoConsumedMessageRepository } from "../../src/messaging/consumed-message.repository";

describe("MongoConsumedMessageRepository", () => {
  const collection = {
    insertOne: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    createIndex: jest.fn(),
  };
  const client = {
    db: jest.fn(() => ({ collection: jest.fn(() => collection) })),
  } as unknown as MongoClient;
  const repository = new MongoConsumedMessageRepository(client, {
    get: jest.fn().mockReturnValue(300000),
  } as never);

  beforeEach(() => jest.clearAllMocks());

  it("creates the unique consumer and event index before claiming a message", async () => {
    collection.insertOne.mockResolvedValue({});

    await expect(
      repository.claim("billing-budget-requested", "event-1"),
    ).resolves.toEqual(expect.objectContaining({ token: expect.any(String) }));

    expect(collection.createIndex).toHaveBeenCalledWith(
      { consumerName: 1, eventId: 1 },
      { unique: true, name: "consumed_message_consumer_event_unique" },
    );
    expect(collection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerName: "billing-budget-requested",
        eventId: "event-1",
        status: "PROCESSING",
      }),
    );
  });

  it("does not claim a completed duplicate and atomically retries a failed message", async () => {
    collection.insertOne.mockRejectedValue({ code: 11000 });
    collection.findOne.mockResolvedValueOnce({ status: "PROCESSED" });

    await expect(
      repository.claim("billing-budget-requested", "event-1"),
    ).resolves.toBeNull();

    collection.findOne.mockResolvedValueOnce({ status: "FAILED" });
    collection.findOneAndUpdate.mockResolvedValueOnce({ status: "PROCESSING" });
    await expect(
      repository.claim("billing-budget-requested", "event-1"),
    ).resolves.toEqual(expect.objectContaining({ token: expect.any(String) }));
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      {
        consumerName: "billing-budget-requested",
        eventId: "event-1",
        $or: expect.any(Array),
      },
      expect.any(Object),
      { returnDocument: "after" },
    );
  });

  it("rejects a concurrent message that is already processing", async () => {
    collection.insertOne.mockRejectedValue({ code: 11000 });
    collection.findOne.mockResolvedValue({
      status: "PROCESSING",
      leaseExpiresAt: new Date(Date.now() + 60000),
    });

    await expect(
      repository.claim("billing-budget-requested", "event-1"),
    ).rejects.toThrow("already processing");
  });

  it("recovers an expired claim and rejects stale claim completion", async () => {
    collection.insertOne.mockRejectedValue({ code: 11000 });
    collection.findOne.mockResolvedValue({
      status: "PROCESSING",
      leaseExpiresAt: new Date(Date.now() - 1),
    });
    collection.findOneAndUpdate.mockResolvedValue({ status: "PROCESSING" });

    await expect(
      repository.claim("billing-budget-requested", "event-1"),
    ).resolves.toEqual(expect.objectContaining({ token: expect.any(String) }));

    collection.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
      repository.markProcessed(
        "billing-budget-requested",
        "event-1",
        "old-token",
      ),
    ).rejects.toThrow("claim was lost");
    await expect(
      repository.markFailed("billing-budget-requested", "event-1", "old-token"),
    ).rejects.toThrow("claim was lost");
  });

  it("propagates database failures", async () => {
    collection.insertOne.mockRejectedValue(new Error("database unavailable"));

    await expect(
      repository.claim("billing-budget-requested", "event-1"),
    ).rejects.toThrow("database unavailable");
  });
});
