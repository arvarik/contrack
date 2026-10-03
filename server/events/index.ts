// =============================================================================
// Domain events
// =============================================================================
// A write records what it changed in its own transaction (`recordEvent`),
// then calls `dispatchEvents()` after the transaction returns. Subscribers
// react after the commit, from a cursor each, so every write path that
// records an event gets the same reactions. The event types and their payload
// schemas are in shared/contracts/events.ts.
// =============================================================================

export { recordEvent } from "./record.ts";
export {
  dispatchEvents,
  MAX_FAILURES,
  registerSubscriber,
  registerSubscribers,
  registeredSubscriberIds,
  type AnyDomainEvent,
  type DomainEvent,
  type Subscriber,
} from "./dispatcher.ts";
