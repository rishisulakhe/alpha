import { describe, expect, test } from "bun:test";
import { retryDelay, createRetryEvent, cancellableSleep, withRetry } from "../src/retry.ts";
import type { ProviderEvent } from "../src/events.ts";
import type { CancellationToken } from "../src/provider.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class TestCancellationToken implements CancellationToken {
  private _cancelled = false;
  isCancelled(): boolean {
    return this._cancelled;
  }
  cancel(): void {
    this._cancelled = true;
  }
}

/** A fake async generator that yields none or some events, then throws. */
async function* failingGenerator(
  eventsToYield: ProviderEvent[],
  failMessage: string,
): AsyncIterable<ProviderEvent> {
  for (const ev of eventsToYield) {
    yield ev;
  }
  throw new Error(failMessage);
}

/** Extract retry events from an event stream. */
function retryProps(ev: ProviderEvent): { attempt: number; maxAttempts: number; delaySeconds: number; message: string } | null {
  if (ev.type === "retry") {
    return { attempt: ev.attempt, maxAttempts: ev.maxAttempts, delaySeconds: ev.delaySeconds, message: ev.message };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("retryDelay", () => {
  test("first retry (attempt 0) returns base delay", () => {
    expect(retryDelay(0, 60)).toBe(250);
  });

  test("second retry (attempt 1) doubles", () => {
    expect(retryDelay(1, 60)).toBe(500);
  });

  test("third retry (attempt 2) doubles again", () => {
    expect(retryDelay(2, 60)).toBe(1000);
  });

  test("caps at maxDelayMs", () => {
    expect(retryDelay(10, 2)).toBe(2000);
  });

  test("returns 0 when maxDelaySeconds is 0 or negative", () => {
    expect(retryDelay(0, 0)).toBe(0);
    expect(retryDelay(5, -1)).toBe(0);
  });

  test("base delay clamped to maxDelay when maxDelay < base", () => {
    expect(retryDelay(0, 0.1)).toBe(100);
  });
});

describe("createRetryEvent", () => {
  test("creates a retry event with correct metadata", () => {
    const ev = createRetryEvent(0, 3, 500);
    const r = retryProps(ev);
    expect(r).not.toBeNull();
    expect(r!.attempt).toBe(1);
    expect(r!.maxAttempts).toBe(3);
    expect(r!.delaySeconds).toBe(0.5);
    expect(r!.message).toContain("1/3");
  });

  test("message includes delay when non-zero", () => {
    const ev = createRetryEvent(1, 5, 2000);
    const r = retryProps(ev);
    expect(r!.message).toContain("2.0s");
  });

  test("message omits delay when zero", () => {
    const ev = createRetryEvent(0, 2, 0);
    const r = retryProps(ev);
    expect(r!.delaySeconds).toBe(0);
    // Should not have the delay suffix pattern like "in 0.5s"
    expect(r!.message).not.toContain("in 0.");
  });
});

describe("cancellableSleep", () => {
  test("returns true when not cancelled", async () => {
    const signal = new TestCancellationToken();
    expect(await cancellableSleep(10, signal)).toBe(true);
  });

  test("returns true when no signal provided", async () => {
    expect(await cancellableSleep(10)).toBe(true);
  });

  test("returns false when already cancelled before sleep", async () => {
    const signal = new TestCancellationToken();
    signal.cancel();
    expect(await cancellableSleep(100, signal)).toBe(false);
  });

  test("handles zero ms sleep", async () => {
    const signal = new TestCancellationToken();
    expect(await cancellableSleep(0, signal)).toBe(true);
  });

  test("returns true for negative ms when not cancelled", async () => {
    expect(await cancellableSleep(-10)).toBe(true);
  });
});

describe("withRetry", () => {
  test("passes through events on success (no errors)", async () => {
    async function* okGen(): AsyncIterable<ProviderEvent> {
      yield { type: "text_delta", text: "hello" } satisfies ProviderEvent;
      yield {
        type: "response_end",
        message: { role: "assistant", content: "hello", tool_calls: [] },
        finishReason: "stop",
      } satisfies ProviderEvent;
    }

    const events: ProviderEvent[] = [];
    for await (const ev of withRetry({ maxRetries: 3, maxDelaySeconds: 1 }, () => okGen())) {
      events.push(ev);
    }

    expect(events.length).toBe(2);
    const ev0 = events[0]!;
    const ev1 = events[1]!;
    if (ev0.type === "text_delta") {
      expect(ev0.text).toBe("hello");
    }
    if (ev1.type === "response_end") {
      expect(ev1.finishReason).toBe("stop");
    }
  });

  test("retries on thrown errors and succeeds eventually", async () => {
    let call = 0;
    function makeGen(): () => AsyncIterable<ProviderEvent> {
      return () => {
        call++;
        if (call < 3) {
          return failingGenerator([], `attempt ${call} failed`);
        }
        return (async function* () {
          yield { type: "text_delta", text: "success" } satisfies ProviderEvent;
        })();
      };
    }

    const events: ProviderEvent[] = [];
    for await (const ev of withRetry({ maxRetries: 5, maxDelaySeconds: 0.5 }, makeGen())) {
      events.push(ev);
    }

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "retry").length).toBe(2);
    expect(types.filter((t) => t === "text_delta").length).toBe(1);
    const last = events[events.length - 1];
    expect(last).toBeDefined();
    expect(last!.type).toBe("text_delta");
  });

  test("returns error event when max retries exceeded", async () => {
    function makeGen(): () => AsyncIterable<ProviderEvent> {
      return () => failingGenerator([], "persistent failure");
    }

    const events: ProviderEvent[] = [];
    for await (const ev of withRetry({ maxRetries: 2, maxDelaySeconds: 0.1 }, makeGen())) {
      events.push(ev);
    }

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "retry").length).toBe(2);
    const last = events[events.length - 1]!;
    expect(last.type).toBe("error");
    if (last.type === "error") {
      expect(last.recoverable).toBe(false);
      expect(last.message).toBe("persistent failure");
    }
  });

  test("returns error event when cancelled mid-retry", async () => {
    const signal = new TestCancellationToken();

    // Generator that always fails
    function makeGen(): () => AsyncIterable<ProviderEvent> {
      return () => failingGenerator([], "fail");
    }

    const events: ProviderEvent[] = [];
    const iterator = withRetry({ maxRetries: 5, maxDelaySeconds: 2, signal }, makeGen())[Symbol.asyncIterator]();

    // Get the first retry event
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toBeDefined();
    expect(first.value!.type).toBe("retry");

    // Cancel before next iteration
    signal.cancel();

    // Collect remaining events
    while (true) {
      const result = await iterator.next();
      if (result.done) break;
      events.push(result.value);
    }

    // Should have an error event mentioning cancellation
    const cancelErrors = events.filter((e) => e.type === "error" && e.message.includes("cancelled"));
    expect(cancelErrors.length).toBe(1);
  });

  test("zero maxRetries means no retry — fails immediately", async () => {
    function makeGen(): () => AsyncIterable<ProviderEvent> {
      return () => failingGenerator([], "fail");
    }

    const events: ProviderEvent[] = [];
    for await (const ev of withRetry({ maxRetries: 0, maxDelaySeconds: 0.1 }, makeGen())) {
      events.push(ev);
    }

    expect(events.length).toBe(1);
    const first = events[0]!;
    expect(first.type).toBe("error");
    if (first.type === "error") {
      expect(first.message).toBe("fail");
    }
  });

  test("retry events contain correct attempt numbers", async () => {
    let call = 0;
    function makeGen(): () => AsyncIterable<ProviderEvent> {
      return () => {
        call++;
        if (call < 4) return failingGenerator([], `error ${call}`);
        return (async function* () {
          yield { type: "text_delta", text: "ok" } satisfies ProviderEvent;
        })();
      };
    }

    const retryPropsList: Array<{ attempt: number; maxAttempts: number }> = [];
    for await (const ev of withRetry({ maxRetries: 5, maxDelaySeconds: 0.1 }, makeGen())) {
      if (ev.type === "retry") {
        retryPropsList.push({ attempt: ev.attempt, maxAttempts: ev.maxAttempts });
      }
    }

    expect(retryPropsList.length).toBe(3);
    expect(retryPropsList[0]!.attempt).toBe(1);
    expect(retryPropsList[1]!.attempt).toBe(2);
    expect(retryPropsList[2]!.attempt).toBe(3);
    expect(retryPropsList[0]!.maxAttempts).toBe(6);
  });

  test("first attempt that succeeds yields no retry event", async () => {
    async function* okGen(): AsyncIterable<ProviderEvent> {
      yield { type: "text_delta", text: "first try works" } satisfies ProviderEvent;
    }

    const events: ProviderEvent[] = [];
    for await (const ev of withRetry({ maxRetries: 3, maxDelaySeconds: 1 }, () => okGen())) {
      events.push(ev);
    }

    expect(events.some((e) => e.type === "retry")).toBe(false);
    expect(events.length).toBe(1);
  });
});
