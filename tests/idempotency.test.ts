import { describe, expect, it } from 'vitest';
import { createIdempotencyTracker } from '../src/lib/idempotency';

describe('createIdempotencyTracker', () => {
  it('reuses the key for an identical retry', () => {
    const tracker = createIdempotencyTracker();
    const first = tracker.keyFor('{"amount":100}');
    expect(tracker.keyFor('{"amount":100}')).toBe(first);
  });

  it('issues a fresh key when the payload changes', () => {
    const tracker = createIdempotencyTracker();
    const first = tracker.keyFor('{"amount":100}');
    expect(tracker.keyFor('{"amount":200}')).not.toBe(first);
  });

  it('issues a new key after a successful submit is reset', () => {
    const tracker = createIdempotencyTracker();
    const first = tracker.keyFor('{"amount":100}');
    tracker.reset();
    expect(tracker.keyFor('{"amount":100}')).not.toBe(first);
  });
});
