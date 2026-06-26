import type { CancellationToken } from "./provider.ts";
import type { ProviderEvent } from "./events.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RETRY_POLL_MS = 50;
const RETRY_BASE_DELAY_SECONDS = 0.25;

// ---------------------------------------------------------------------------
// retryDelay — exponential backoff in milliseconds
// ---------------------------------------------------------------------------

export function retryDelay(attempt: number, maxDelaySeconds: number): number {
  if (maxDelaySeconds <= 0) return 0;
  const maxDelayMs = maxDelaySeconds * 1000;
  const baseDelay = Math.min(RETRY_BASE_DELAY_SECONDS, maxDelaySeconds);
  return Math.min(maxDelayMs, baseDelay * Math.pow(2, attempt) * 1000);
}

// ---------------------------------------------------------------------------
// createRetryEvent — build a provider-neutral retry progress event
// ---------------------------------------------------------------------------

export function createRetryEvent(
  attempt: number,
  maxAttempts: number,
  delayMs: number,
): ProviderEvent {
  const displayAttempt = attempt + 1;
  const delaySeconds = delayMs / 1000;
  const delaySuffix = delaySeconds > 0 ? ` in ${delaySeconds.toFixed(1)}s` : "";
  return {
    type: "retry",
    attempt: displayAttempt,
    maxAttempts,
    delaySeconds,
    message: `Retrying provider request ${displayAttempt}/${maxAttempts} after transient error${delaySuffix}.`,
  };
}

// ---------------------------------------------------------------------------
// cancellableSleep — sleep while allowing cancellation
// ---------------------------------------------------------------------------

export async function cancellableSleep(
  ms: number,
  signal?: CancellationToken,
): Promise<boolean> {
  if (ms <= 0) {
    return signal == null || !signal.isCancelled();
  }

  let remaining = ms;
  while (remaining > 0) {
    if (signal?.isCancelled()) return false;
    const step = Math.min(RETRY_POLL_MS, remaining);
    await new Promise((resolve) => setTimeout(resolve, step));
    remaining -= step;
  }
  return signal == null || !signal.isCancelled();
}

// ---------------------------------------------------------------------------
// withRetry — wrap an async generator with exponential backoff retry
// ---------------------------------------------------------------------------

export async function* withRetry(
  opts: {
    maxRetries: number;
    maxDelaySeconds: number;
    signal?: CancellationToken;
  },
  fn: () => AsyncIterable<ProviderEvent>,
): AsyncIterable<ProviderEvent> {
  const maxAttempts = opts.maxRetries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      for await (const event of fn()) {
        yield event;
      }
      return;
    } catch (error) {
      const isLastAttempt = attempt + 1 >= maxAttempts;

      if (isLastAttempt) {
        const msg = error instanceof Error ? error.message : String(error);
        yield { type: "error", message: msg, recoverable: false } satisfies ProviderEvent;
        return;
      }

      const delayMs = retryDelay(attempt, opts.maxDelaySeconds);
      yield createRetryEvent(attempt, maxAttempts, delayMs);

      const ok = await cancellableSleep(delayMs, opts.signal);
      if (!ok) {
        yield { type: "error", message: "Retry cancelled by user.", recoverable: false } satisfies ProviderEvent;
        return;
      }
    }
  }
}
