/** Local copy of the versioned order-flow envelope defined by ADR 005. */
export interface OrderFlowMessageEnvelope<TEventName extends string, TPayload> {
  eventId: string;
  eventName: TEventName;
  eventVersion: 1;
  occurredAt: string;
  correlationId: string;
  causationId: string;
  sagaId: string;
  orderId: string;
  payload: TPayload;
}
