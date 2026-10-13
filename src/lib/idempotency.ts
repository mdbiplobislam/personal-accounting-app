// Idempotency keys for money-moving submits.
//
// A retry of the *same* payload reuses the same key, so the database returns the original row
// instead of posting a second one (double-click, flaky network, impatient retry).
// A *changed* payload gets a fresh key, so an edit after a failed attempt is never swallowed.

export interface IdempotencyTracker {
  keyFor: (signature: string) => string;
  reset: () => void;
}

export function createIdempotencyTracker(): IdempotencyTracker {
  let last: { signature: string; key: string } | null = null;
  return {
    keyFor(signature: string) {
      if (last && last.signature === signature) return last.key;
      last = { signature, key: crypto.randomUUID() };
      return last.key;
    },
    reset() {
      last = null;
    },
  };
}
