import { createDeterministicEventId } from "../../src/messaging/deterministic-event-id";

describe("createDeterministicEventId", () => {
  it("is stable for a retry of the same aggregate transition", () => {
    expect(
      createDeterministicEventId(
        "budget.approved",
        "budget-1",
        "APPROVED:budget-1",
      ),
    ).toBe(
      createDeterministicEventId(
        "budget.approved",
        "budget-1",
        "APPROVED:budget-1",
      ),
    );
  });

  it("distinguishes business transitions", () => {
    expect(
      createDeterministicEventId(
        "budget.approved",
        "budget-1",
        "APPROVED:budget-1",
      ),
    ).not.toBe(
      createDeterministicEventId(
        "budget.rejected",
        "budget-1",
        "REJECTED:budget-1",
      ),
    );
  });
});
