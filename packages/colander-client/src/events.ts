/** A source-neutral event emitted by a future event or webhook adapter. */
export interface ColanderEvent<TPayload = unknown> {
  readonly type: string;
  readonly payload: TPayload;
  readonly id?: string;
  readonly occurredAt?: string;
}

/**
 * A listener consumes one event payload type. Its parameter is deliberately
 * contravariant, so a listener for a wider payload can be used where a narrower
 * payload is expected.
 */
export type ColanderEventListener<TPayload = unknown> = (event: ColanderEvent<TPayload>) => void;

/**
 * A subscription boundary; the returned function removes the listener.
 *
 * The callable property (rather than a method declaration) keeps payload
 * variance strict under `strictFunctionTypes` for both consumers and adapters.
 */
export interface ColanderEventSource<TPayload = unknown> {
  readonly subscribe: (listener: ColanderEventListener<TPayload>) => () => void;
}
