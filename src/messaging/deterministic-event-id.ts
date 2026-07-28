import { createHash } from "crypto";

export function createDeterministicEventId(
  eventName: string,
  aggregateId: string,
  transition: string,
): string {
  return createHash("sha256")
    .update(`${eventName}\u001f${aggregateId}\u001f${transition}`)
    .digest("hex");
}
