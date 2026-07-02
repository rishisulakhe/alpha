# Alpha — TypeScript Coding Agent Roadmap

> **Goal:** Build a Pi-style/Tau-style coding-agent harness in TypeScript from scratch, for learning. Each step is a self-contained milestone with context, coding prompt, and testing guidance.
>
> **Stack:** Bun workspaces · TypeScript (strict) · Zod · `bun:test` · Ink (React-for-CLI TUI)
>
> **Packages:** `alpha-ai` (providers) → `alpha-agent` (core loop/harness/sessions) → `alpha-coding` (tools/CLI/TUI)

---

## Progress Tracker

| Phase | Steps | Status | Notes |
|---|---|---|---|
| 1 — Foundation | 1-4 | ✅ Complete | Monorepo, JSON types, messages, tools |
| 2 — Provider Layer | 5-9 | ✅ Complete | Provider protocol, events, OpenAI, Anthropic |
| 3 — Agent Loop | 10-14 | ✅ Complete | Agent events, loop, tool execution, queues |
| 4 — Agent Harness | 15-18 | ✅ Complete | Harness, queues, listeners, cancellation |
| 5 — Session Storage | 19-23 | ✅ Complete | Entry types, JSONL, storage, tree reconstruction |
| 6 — Coding Tools | 24-27 | ✅ Complete | Read, write, edit, bash tools |
| 7 — App Foundation | 28-33 | ✅ Complete | Paths, credentials, providers, skills, templates |
| 8 — Context | 34-37 | ✅ Complete | Context discovery, tokens, compaction, thinking |
| 9 — CodingSession | 38-40 | ✅ Complete | Session orchestrator, persistence, manager |
| — Enhanced Session | — | ✅ Complete | Per-project indexing, HTML/JSONL export, default sessions |
| — Commands | — | ✅ Complete | Slash command registry, 18 builtin commands |
| — OAuth | — | ✅ Complete | OpenAI Codex login flow with PKCE |
| 10 — CLI & TUI | 41-44 | 🟡 Partial | CLI modes done, Ink TUI with streaming |
| — TUI Core | — | ✅ Complete | State management, event adapter, streaming |
| — Pickers | — | ✅ Complete | Model, session, theme, tree, thinking pickers |
| — Autocomplete | — | ✅ Complete | Slash commands, models, skills completion |
| — Sidebar | — | ✅ Complete | Session info, context usage, activity indicator |

---

## Phase 1 — Project Foundation (Steps 1–4)

### Step 1: Initialize Bun Workspaces Monorepo

**Context:** Alpha follows a three-package monorepo structure like Pi and Tau. Bun workspaces give fast installs, native TypeScript support, and a built-in test runner.

**What to build:**
- Root `package.json` with `"workspaces": ["packages/*"]`
- Root `tsconfig.base.json` with strict TypeScript settings (`target: "ES2022"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `strict: true`, `declaration: true`)
- Three package directories: `packages/ai/`, `packages/agent/`, `packages/coding/`
- Each package gets its own `package.json` (name scoped: `@alpha/ai`, `@alpha/agent`, `@alpha/coding`) and a `tsconfig.json` extending the base
- Each package gets a minimal `src/index.ts` with a placeholder export
- `.gitignore` covering `node_modules`, `dist`, `.env`, `*.log`
- Add `scripts` in root: `"typecheck": "bun --filter '*' run typecheck"`, `"test": "bun --filter '*' test"`, `"lint": "bunx biome check ."`

**Testing:** Verify with `bun install && bun run typecheck && bun run test` — all three packages should have passing (empty) typecheck and tests.

---

### Step 2: Define Core JSON Types & Type Aliases

**Context:** Tau and Pi both start with generic JSON types as the lingua franca for tool arguments, data payloads, and event metadata. These are simple recursive types — no runtime validation needed at this layer, just TypeScript type aliases.

**What to build (in `packages/agent/src/types/json.ts`):**
```ts
type JSONPrimitive = string | number | boolean | null;
type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
type JSONObject = Record<string, JSONValue>;
```

**Testing:** Write a type-level test file that verifies assignability — e.g., `const x: JSONValue = { a: [1, "b", null] }` compiles, and structural subtyping works as expected.

---

### Step 3: Define Provider-Neutral Message Models

**Context:** The transcript is a list of messages that represents the conversation between user, assistant, and tools. These must be provider-neutral — the provider layer translates them to/from provider-specific formats. Tau uses Pydantic; here use Zod for runtime validation.

**What to build (in `packages/agent/src/messages.ts`):**

Three Zod schemas:
- `UserMessage` — `{ role: "user", content: string }`
- `ToolCall` — `{ id: string, name: string, arguments: JSONObject }`
- `AssistantMessage` — `{ role: "assistant", content: string, tool_calls?: ToolCall[] }`
- `ToolResultMessage` — `{ role: "tool", tool_call_id: string, name: string, content: string, ok: boolean, data?: JSONObject, details?: JSONObject, error?: string }`
- `AgentMessage` — discriminated union: `z.discriminatedUnion("role", [...])`

Add helper functions: `isUserMessage(msg)`, `isAssistantMessage(msg)`, `isToolResultMessage(msg)` — type guard functions.

**Testing:** Verify serialization round-trips (`JSON.parse(JSON.stringify(msg))` preserves the shape), discriminated union parsing (the correct schema variant is chosen based on `role`), and rejection of invalid messages (wrong role, missing required fields).

---

### Step 4: Define Tool Primitives

**Context:** Before building the agent loop, define the tool abstraction. Tools are the mechanism by which the agent inspects and modifies the environment. This is provider-neutral — the loop matches tool calls by name and executes the corresponding executor.

**What to build (in `packages/agent/src/tools.ts`):**

- `AgentTool` interface:
  ```ts
  interface AgentTool {
    name: string;
    description: string;
    inputSchema: JSONObject;  // JSON Schema for the tool parameters
    execute(args: JSONObject, signal: CancellationToken): Promise<AgentToolResult>;
    // Optional prompt metadata:
    promptSnippet?: string;
    promptGuidelines?: string;
  }
  ```
- `AgentToolResult` — `{ toolCallId: string, name: string, ok: boolean, content: string, data?: JSONObject, details?: JSONObject, error?: string }`
- `CancellationToken` interface: `{ isCancelled: () => boolean }`
- `ToolCall` re-exported from messages or co-located

**Testing:** Create a fake tool that echoes its arguments, verify `execute()` receives the correct `arguments` and `signal`, verify the result shape.

---

## Phase 2 — Provider Layer (`alpha-ai`)

### Step 5: Define ModelProvider Protocol & ProviderEvent Types

**Context:** The provider layer translates external LLM APIs (OpenAI, Anthropic) into Tau's provider-neutral streaming event model. Every provider implements the `ModelProvider` protocol. The agent loop never imports provider-specific code.

**What to build (in `packages/ai/src/provider.ts`):**

- `CancellationToken` — re-export or define (protocol compatible with agent's version)
- `ModelProvider` interface:
  ```ts
  interface ModelProvider {
    streamResponse(params: {
      model: string;
      system: string;
      messages: AgentMessage[];
      tools: AgentTool[];
      signal: CancellationToken;
    }): AsyncIterable<ProviderEvent>;
  }
  ```

**ProviderEvent types (in `packages/ai/src/events.ts`):**
- `ProviderResponseStartEvent` — `{ type: "response_start", model: string }`
- `ProviderRetryEvent` — `{ type: "retry", attempt: number, maxAttempts: number, delaySeconds: number, message: string }`
- `ProviderTextDeltaEvent` — `{ type: "text_delta", text: string }`
- `ProviderThinkingDeltaEvent` — `{ type: "thinking_delta", text: string }`
- `ProviderToolCallEvent` — `{ type: "tool_call", call: ToolCall }`
- `ProviderResponseEndEvent` — `{ type: "response_end", message: AssistantMessage, finishReason: string, usage?: Usage }`
- `ProviderErrorEvent` — `{ type: "error", message: string, statusCode?: number, recoverable: boolean }`
- `ProviderEvent` — discriminated union of all above

- `Usage` type: `{ inputTokens: number, outputTokens: number, cacheReadTokens?: number }`
- `FinishReason` — `"stop" | "length" | "tool_use" | "error" | "aborted"`

**Testing:** Write type-level tests for each event shape. Verify discriminated union parsing.

---

### Step 6: Implement FakeProvider

**Context:** A deterministic test provider that replays scripted `ProviderEvent` sequences. This is critical — every agent loop and harness test will use the FakeProvider so tests are fast and deterministic (no network calls).

**What to build (in `packages/ai/src/fake.ts`):**

- `FakeProvider` class implementing `ModelProvider`
  - Constructor takes `scriptedStreams: ProviderEvent[][]` — array of event arrays, one per `streamResponse()` call
  - Each call to `streamResponse()` consumes the next scripted stream
  - Records calls for assertion: `calls: Array<{ model, system, messages, tools }>`
  - `streamResponse()` is an `async function*` that yields each event in the current stream
  - Helper builder: `FakeProvider.singleTextResponse(content: string)` — convenience for single-turn text-only tests
  - Helper builder: `FakeProvider.singleToolCallResponse(calls: ToolCall[])` — for tool loop tests

**Testing:** Test that `FakeProvider` replays events in order, consumes one stream per call, records call arguments, and throws/returns appropriate events when out of scripted streams.

---

### Step 7: Implement Retry Logic

**Context:** Both Pi and Tau implement exponential backoff with jitter for transient provider failures. The retry module emits `ProviderRetryEvent` so the UI can show retry progress, and it respects cancellation.

**What to build (in `packages/ai/src/retry.ts`):**

- `retryDelay(attempt: number, maxDelaySeconds: number): number` — `min(maxDelay, 0.25 * 2^attempt)` seconds, measured in milliseconds
- `createRetryEvent(attempt: number, maxAttempts: number, delayMs: number): ProviderRetryEvent`
- `withRetry<T>(opts: { maxRetries: number; maxDelaySeconds: number; signal: CancellationToken }, fn: () => AsyncIterable<ProviderEvent>): AsyncIterable<ProviderEvent>`
  - Wraps an async generator
  - On error: yields `ProviderRetryEvent`, waits (cancellable sleep), retries
  - On success: passes through all events
  - On cancellation mid-retry: yields `ProviderErrorEvent` with `recoverable: false`
  - On max retries exceeded: yields `ProviderErrorEvent`
- `cancellableSleep(ms: number, signal: CancellationToken): Promise<void>` — polls `isCancelled()` every 50ms

**Testing:** Test delay calculation at various attempts, test that retry wrapper retries on thrown errors (use a fake generator that throws N times then succeeds), test cancellation mid-retry, test max retry exhaustion.

---

### Step 8: Implement OpenAI-Compatible Provider

**Context:** The most common provider pattern — any endpoint that exposes `/chat/completions` with SSE streaming. OpenAI, OpenRouter, local Ollama/LM Studio, Huggingface, etc. all fit this pattern.

**What to build (in `packages/ai/src/providers/openai-compatible.ts`):**

- `OpenAICompatibleConfig` — `{ apiKey: string; baseUrl: string; headers?: Record<string,string>; timeoutSeconds?: number; maxRetries?: number; maxRetryDelaySeconds?: number }`
- `OpenAICompatibleProvider` implements `ModelProvider`
  - `streamResponse()` flow:
    1. Build chat completions payload: convert `AgentMessage[]` to OpenAI message format (`role` + `content`), convert `AgentTool[]` to function definitions (`{ type: "function", function: { name, description, parameters } }`)
    2. POST to `<baseUrl>/chat/completions` with `stream: true` (using `fetch` + SSE parsing)
    3. Parse SSE deltas: `content` → `ProviderTextDeltaEvent`, `tool_calls` delta chunks → accumulate into `ToolCallBuilder` → `ProviderToolCallEvent` on completion, `reasoning_content`/`reasoning` → `ProviderThinkingDeltaEvent`
    4. On `[DONE]` → emit `ProviderResponseEndEvent` with built `AssistantMessage`
    5. Wrap entire streaming function in `withRetry()`

- `ToolCallBuilder` class:
  - `addDelta(index: number, delta: { id?: string; function?: { name?: string; arguments?: string } })` — accumulates fragments
  - `build(index: number): ToolCall` — assembles final ToolCall with JSON-parsed arguments

- `convertToOpenAIMessage(msg: AgentMessage)` — maps Tau messages to OpenAI chat format
- `convertTools(tools: AgentTool[])` — maps Tau tools to OpenAI function definitions

**Testing:** Test `ToolCallBuilder` accumulation (single delta, multiple deltas, cross-index), test `convertToOpenAIMessage`, test `convertTools` schema output. Integration test with a local mock server (e.g., `bun`'s `serve()`) that responds with scripted SSE events.

---

### Step 9: Implement Anthropic Provider

**Context:** Anthropic's Messages API has a different streaming format (content blocks, SSE events with `content_block_start`, `content_block_delta`, `message_delta`). The provider translates it to the same `ProviderEvent` stream.

**What to build (in `packages/ai/src/providers/anthropic.ts`):**

- `AnthropicConfig` — `{ apiKey: string; baseUrl?: string; timeoutSeconds?: number; maxRetries?: number; maxRetryDelaySeconds?: number; thinkingBudgetTokens?: number }`
- `AnthropicProvider` implements `ModelProvider`
  - `streamResponse()` flow:
    1. Convert `AgentMessage[]` → Anthropic message format (user→`{role:"user",content:text}`, assistant→`{role:"assistant",content:[text_block,...tool_use_blocks]}`, tool→`{role:"user",content:[{type:"tool_result",tool_use_id,name,content}]}`)
    2. Convert `AgentTool[]` → Anthropic tool definitions (`{ name, description, input_schema }`)
    3. POST to `<baseUrl>/messages` with `stream: true`, appropriate headers (`x-api-key`, `anthropic-version`, `anthropic-beta` for thinking)
    4. Parse SSE events: `content_block_start` → track block type, `content_block_delta` with `text_delta` → `ProviderTextDeltaEvent`, `thinking_delta` → `ProviderThinkingDeltaEvent`, `input_json_delta` → accumulate for tool calls, `message_delta` → stop_reason
    5. Build `AssistantMessage` with text content and tool calls
    6. Wrap in `withRetry()`

- `AnthropicToolBuilder` — similar to OpenAI's ToolCallBuilder but matches Anthropic's `id` + `name` + `input` accumulation pattern
- `convertToAnthropicMessage(msg: AgentMessage)` — maps Tau messages to Anthropic format
- `convertToAnthropicTools(tools: AgentTool[])` — maps to Anthropic tool format

**Testing:** Test message conversion (user, assistant with tool calls, tool results), test tool conversion, test tool builder accumulation. Integration test with a local mock server.

---

## Phase 3 — Core Agent Loop (`alpha-agent`)

### Step 10: Define AgentEvent Types

**Context:** These are the 14 event types emitted by the agent loop. They form the contract between the loop and all consumers (harness, coding session, renderers, TUI). Every meaningful step is observable through these events.

**What to build (in `packages/agent/src/events.ts`):**

14 Zod-validated event types, discriminated by `type`:
| Event | `type` | Key fields |
|---|---|---|
| `AgentStartEvent` | `"agent_start"` | — |
| `AgentEndEvent` | `"agent_end"` | — |
| `TurnStartEvent` | `"turn_start"` | `turn: number` |
| `TurnEndEvent` | `"turn_end"` | `turn: number` |
| `RetryEvent` | `"retry"` | `attempt`, `maxAttempts`, `delaySeconds`, `message` |
| `QueueUpdateEvent` | `"queue_update"` | `steering: string[]`, `followUp: string[]` |
| `MessageStartEvent` | `"message_start"` | `role: "user" \| "assistant" \| "tool"` |
| `MessageDeltaEvent` | `"message_delta"` | `text: string` |
| `ThinkingDeltaEvent` | `"thinking_delta"` | `text: string` |
| `MessageEndEvent` | `"message_end"` | `message: AgentMessage` |
| `ToolExecutionStartEvent` | `"tool_execution_start"` | `call: ToolCall` |
| `ToolExecutionUpdateEvent` | `"tool_execution_update"` | `message: string` |
| `ToolExecutionEndEvent` | `"tool_execution_end"` | `result: AgentToolResult` |
| `ErrorEvent` | `"error"` | `message: string`, `recoverable: boolean`, `statusCode?: number` |

- `AgentEvent` — discriminated union of all 14 types
- Export type guard helpers: `isMessageEndEvent`, `isToolExecutionEndEvent`, etc.

**Testing:** Verify that each event type has the correct `type` literal, that serialization round-trips, and that the discriminated union works correctly (`z.parse(AgentEventSchema, eventObj)` chooses the right variant).

---

### Step 11: Implement the Pure Agent Loop

**Context:** `runAgentLoop()` is the core async generator. It takes the context (system prompt, messages, tools, model, provider) and produces an `AsyncIterable<AgentEvent>`. It is stateless and provider-agnostic — pure orchestration of the "model calls → tool execution → model calls" cycle.

**What to build (in `packages/agent/src/loop.ts`):**

```ts
async function* runAgentLoop(opts: {
  provider: ModelProvider;
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  maxTurns?: number;
  signal: CancellationToken;
  getSteeringMessages?: () => AgentMessage[];
  getFollowUpMessages?: () => AgentMessage[];
}): AsyncIterable<AgentEvent>
```

**Loop algorithm:**
1. Yield `AgentStartEvent`
2. For each turn (up to `maxTurns`):
   a. Check cancellation → break
   b. Yield `TurnStartEvent(turn)`
   c. **Drain steering messages:** if `getSteeringMessages` returns messages, extend `messages`, yield `MessageStartEvent`/`MessageEndEvent` pairs, yield `QueueUpdateEvent`
   d. **Stream from provider:** iterate `provider.streamResponse()`, translate each `ProviderEvent`:
      - `response_start` → `MessageStartEvent("assistant")`
      - `text_delta` → `MessageDeltaEvent`
      - `thinking_delta` → `ThinkingDeltaEvent`
      - `retry` → `RetryEvent`
      - `tool_call` → accumulate
      - `response_end` → append `AssistantMessage` to messages, yield `MessageEndEvent`
      - `error` → yield `ErrorEvent`, break turn
   e. **Handle tool calls:** If assistant message has tool calls → execute them (`executeToolCalls()`), append `ToolResultMessage`s to messages; drain steering messages; continue to next turn
   f. **No tool calls:** drain steering queue, then drain follow-up queue (these extend `messages` and produce events). If follow-up messages were added, continue to next turn. Otherwise break.
3. Yield `AgentEndEvent`

**Helper functions:**
- `executeToolCalls(calls, toolsByName, signal)` — async generator that yields `ToolExecutionStartEvent`, runs tool, yields `ToolExecutionEndEvent` with result
- `drainQueuedMessages(getter)` — async generator that pulls messages from getter and yields `MessageStartEvent`/`MessageEndEvent` pairs

**Key design decisions:**
- `messages` array is **mutated in-place** by the loop (the caller owns it)
- Steering messages are injected **after** the current turn's tool batch and **before** the next provider call
- Follow-up messages are injected only when the loop would otherwise stop (no more tool calls)
- Error events from provider are checked for `recoverable` flag — if unrecoverable, break the outer loop

**Testing:** Use `FakeProvider` with scripted streams:
- Test simple text response: events are in correct order, assistant message appended
- Test thinking deltas: they're emitted but NOT in the assistant message content
- Test tool call loop: provider returns tool_call → execute → provider called again → text response (2 turns)
- Test multi-turn tool loop (3+ turns)
- Test maxTurns limit: yields ErrorEvent with `recoverable: true`
- Test cancellation mid-loop
- Test unknown tool: returns error ToolResultMessage

---

### Step 12: Implement Tool Execution Engine

**Context:** Extract tool execution from the loop into a clean, testable sub-module. This handles the lifecycle: validate tool exists, execute with timeout/cancellation, capture result.

**What to build (in `packages/agent/src/tool-execution.ts`):**

```ts
async function* executeToolCalls(
  calls: ToolCall[],
  toolsByName: Map<string, AgentTool>,
  signal: CancellationToken,
  mode: "sequential" | "parallel" = "sequential"
): AsyncIterable<AgentEvent>
```

**Sequential mode:** For each tool call:
1. Yield `ToolExecutionStartEvent(call)`
2. Look up tool by name
3. If not found: yield `ToolExecutionEndEvent` with error result
4. If found: call `tool.execute(call.arguments, signal)`, yield `ToolExecutionEndEvent(result)`
5. If signal is cancelled mid-batch: remaining tools get synthetic "Tool call cancelled" results

**Parallel mode:**
1. Yield `ToolExecutionStartEvent` for all calls
2. Execute all known tools concurrently with `Promise.all`
3. Yield `ToolExecutionEndEvent` for each result
4. Handle cancellation similarly

**Testing:** Test both modes, test unknown tool handling, test cancellation mid-batch (remaining tools get cancelled results), test successful parallel execution.

---

### Step 13: Implement Steering & Follow-Up Message Injection

**Context:** The agent harness exposes `steer()` and `followUp()` methods that queue messages for mid-run injection. The loop calls `getSteeringMessages()` before each provider call and `getFollowUpMessages()` when it would otherwise stop. Tau's default queue mode is `"one_at_a_time"` (drain one at a time) vs `"all"` (drain as batch).

**What to build (in `packages/agent/src/loop.ts` — extend existing):**

- Add `queueMode: "one_at_a_time" | "all"` to `runAgentLoop` options
- **Steering drain:** before each provider call:
  - `"one_at_a_time"`: call getter, add first message to transcript, stop
  - `"all"`: call getter, add all messages to transcript
- **Follow-up drain:** after turn ends with no tool calls:
  - `"one_at_a_time"`: call getter, add first message, set flag to continue outer loop
  - `"all"`: call getter, add all messages, if any: continue outer loop
- Each drained message yields a `MessageStartEvent("user")`/`MessageEndEvent(userMessage)` pair
- After draining steering, yield `QueueUpdateEvent` with remaining queue contents

**Testing:** Test steering injection between turns (steering message appears before next provider call), test follow-up injection keeps the loop alive, test `"one_at_a_time"` drains one per turn, test `"all"` drains all at once, test that steering takes priority over follow-up.

---

### Step 14: Add Cancellation Support

**Context:** Cancellation must be cooperative — the loop checks the signal at turn boundaries and tool execution boundaries. When cancelled mid-tool-execution, remaining tools in the batch get synthetic "cancelled" results and the loop cleanly stops after the current batch.

**What to build:**

- `SimpleCancellationToken` class: `{ isCancelled: () => this._cancelled; cancel: () => { this._cancelled = true } }`
- In the loop:
  - Check signal at start of each turn → break with `AgentEndEvent`
  - Check signal during tool execution → remaining tools get cancelled results
  - If cancelled during provider stream, abort the fetch and emit `ErrorEvent` with `recoverable: false`
- The loop should never throw from cancellation — it must emit events and exit cleanly

**Testing:** Test cancellation before first turn (only AgentStart/AgentEnd), cancellation mid-tool-batch (remaining tools get cancelled results), cancellation during provider streaming (abort + error event).

---

## Phase 4 — Agent Harness (`alpha-agent`)

### Step 15: Implement AgentHarness with Transcript Management

**Context:** `AgentHarness` wraps the stateless agent loop with state management. It owns the transcript (`AgentMessage[]`), exposes `prompt()`/`continue_()`, manages concurrency (rejects overlapping runs), and emits events through the same generator pattern.

**What to build (in `packages/agent/src/harness.ts`):**

```ts
interface AgentHarnessConfig {
  provider: ModelProvider;
  model: string;
  system: string;
  tools: AgentTool[];
  maxTurns?: number;
  queueMode?: "one_at_a_time" | "all";
}

class AgentHarness {
  constructor(config: AgentHarnessConfig);
  
  // Core API
  get messages(): readonly AgentMessage[];  // immutable snapshot
  get isRunning(): boolean;
  
  async *prompt(content: string): AsyncIterable<AgentEvent>;
  async *continue_(): AsyncIterable<AgentEvent>;
  
  // Message management
  replaceMessages(messages: AgentMessage[]): void;
  
  // Queue management
  steer(content: string): void;
  followUp(content: string): void;
  clearQueues(): { steering: AgentMessage[]; followUp: AgentMessage[] };
  popLatestFollowUp(): AgentMessage | undefined;
  
  // Cancellation
  cancel(): void;
  
  // Listener system
  subscribe(listener: (event: AgentEvent) => void | Promise<void>): () => void;
}
```

**`prompt(content)` flow:**
1. Check `_isRunning` → throw if true
2. Append `UserMessage(content)` to `_messages`
3. Set `_isRunning = true`, create new `SimpleCancellationToken`
4. Use `runAgentLoop()` with current messages, tools, and signal
5. Yield all events from the loop
6. On completion/error: set `_isRunning = false`
7. Always yield `AgentEndEvent`, notify listeners

**`continue_()`**: Same as `prompt()` but without appending a user message. Reuses existing transcript.

**`messages` getter:** Returns `[...this._messages]` (shallow copy — snapshots are immutable).

**Testing (extensive — this is a critical integration point):**
- `prompt()` appends user message and generates assistant response with correct event sequence
- `continue_()` runs without adding a user message
- `messages` property returns a snapshot that is not affected by subsequent appends
- `replaceMessages()` completely replaces the transcript
- Harness rejects overlapping `prompt()` calls (throws Error)
- Harness passes tools to the loop (verify FakeProvider received tools)

---

### Step 16: Implement Message Queuing in the Harness

**Context:** The harness maintains steering and follow-up queues. When TUI users type `Alt+Enter` while the agent is running, `followUp()` queues the message for post-turn injection. When they type while the agent is idle, `steer()` or the next `prompt()` uses it.

**What to build (in the harness):**

- `steer(content: string)` — pushes to `_steeringQueue: UserMessage[]`
- `steerMessage(message: UserMessage)` — pushes direct message (used for skill/template expansions)
- `followUp(content: string)` — pushes to `_followUpQueue: UserMessage[]`
- `followUpMessage(message: UserMessage)` — direct message variant
- `clearQueues()` — returns and empties both queues
- `popLatestFollowUp()` — removes and returns the most recent follow-up (for manual prompt fallback)
- `_getSteeringMessages()` / `_getFollowUpMessages()` closures passed to `runAgentLoop`:
  - `"one_at_a_time"`: shift first element, return `[element]` if any
  - `"all"`: splice entire array, return all

**Queue semantics:**
- `steer()` usable when idle or running (if running, adds as steering; if idle, used on next prompt)
- `followUp()` only meaningful during a run — injects at loop-stop boundary
- When idle and `prompt()` is called: drain any queued steering messages first (prepend to prompt), then process the prompt itself

**Testing:** Test steering injection mid-run (prompt while running → message appears in QueueUpdateEvent → injected between turns), test follow-up keeps loop alive, test `"one_at_a_time"` drains one per turn, test `"all"` drains all, test `popLatestFollowUp()` returns only the most recent, test `clearQueues()`.

---

### Step 17: Implement Event Listener System

**Context:** Listeners allow external code (TUI, session persistence) to observe agent events in real-time. The harness maintains a subscriber list; each event is broadcast to all subscribers.

**What to build (in the harness):**

- `_listeners: Set<(event: AgentEvent) => void | Promise<void>>`
- `subscribe(listener): () => void` — adds listener, returns unsubscribe function
- `_notify(event: AgentEvent)` — iterates all listeners, calls each. Non-blocking (does not await promises — use `.catch()` for error handling)
- `_notifyAndAwait(event: AgentEvent)` — for `agent_end` only: awaits all listener promises before resolving (ensures session writes flush before idle state is visible)

**Design decisions (from Pi/Tau):**
- Listeners receive ALL events — no filtering. Filtering is the listener's responsibility.
- Listeners run in subscription order
- Errors in listeners are caught and logged (they must not break the harness)
- `agent_end` is special: the harness awaits all listeners before returning to idle

**Testing:** Subscribe a listener, verify it receives events, verify unsubscribe stops delivery, verify listeners run in order, verify listener error doesn't crash the harness.

---

### Step 18: Cancellation Handling & Transcript Repair

**Context:** When a run is cancelled mid-tool-execution, the transcript may be in an inconsistent state (tool calls without results). The harness must repair the transcript on next `prompt()` by injecting synthetic `ToolResultMessage`s for any tool calls that were requested but not executed.

**What to build (in the harness):**

- `_repairInterruptedToolResults()`:
  1. Scan `this._messages` for `AssistantMessage`s with `tool_calls`
  2. For each tool call, find the corresponding `ToolResultMessage` by `tool_call_id`
  3. If no result message exists, inject a synthetic `ToolResultMessage` with:
     ```ts
     { ok: false, content: "Tool call interrupted by user.", error: "interrupted" }
     ```
- Call `_repairInterruptedToolResults()` at the start of each `prompt()` call
- `cancel()`: sets the cancellation token, which the loop checks at turn/tool boundaries

**Testing:** Set up a transcript with an assistant message that has tool calls but no results, verify `prompt()` injects repair messages before the new user message, verify repair is done at start of prompt, verify repair does not add duplicate results if already present.

---

## Phase 5 — Session Storage (`alpha-agent`)

### Step 19: Define Session Entry Types

**Context:** Tau and Pi both use an append-only session tree. Each "entry" is an immutable record appended to the session file. State is reconstructed by replaying entries from root to leaf. This enables time-travel, branching, and safe compaction without data loss.

**What to build (in `packages/agent/src/session/entries.ts`):**

Base type: `BaseSessionEntry` — `{ id: string, parentId: string | null, timestamp: string }`

Nine entry types, discriminated by `type`:
1. **`MessageEntry`** — `{ type: "message", message: AgentMessage }` — durable record of one transcript message
2. **`ModelChangeEntry`** — `{ type: "model_change", model: string, providerName?: string }`
3. **`ThinkingLevelChangeEntry`** — `{ type: "thinking_level_change", level: string }`
4. **`CompactionEntry`** — `{ type: "compaction", summary: string, replacesEntryIds: string[] }`
5. **`BranchSummaryEntry`** — `{ type: "branch_summary", summary: string }`
6. **`LabelEntry`** — `{ type: "label", label: string }`
7. **`LeafEntry`** — `{ type: "leaf", entryId: string }` — points to active branch tip
8. **`SessionInfoEntry`** — `{ type: "session_info", cwd: string, title?: string, createdAt: string }`
9. **`CustomEntry`** — `{ type: "custom", namespace: string, data: JSONObject }`

- `SessionEntry` — discriminated union
- Use Zod schemas for each, with `refine()` for validation (e.g., `id` must be unique within a session)

**Testing:** Verify each entry type serializes/deserializes correctly, verify discriminated union parsing, test that duplicate IDs within a session are detected.

---

### Step 20: Implement JSONL Serialization

**Context:** Session entries are stored as JSONL (one JSON object per line). This is append-friendly, human-readable, and easy to stream/mmap.

**What to build (in `packages/agent/src/session/jsonl.ts`):**

- `entryToJsonLine(entry: SessionEntry): string` — `JSON.stringify(entry)` without newlines + `"\n"`
- `entryFromJsonLine(line: string): SessionEntry` — `JSON.parse(line)` → Zod parse
- `entriesFromJsonLines(text: string): SessionEntry[]` — split by `\n`, filter empty, parse each
- Handle malformed lines gracefully (skip with warning, don't crash)

**Testing:** Test round-trip: entry → line → entry, test multiple entries, test handling of empty lines, test error on malformed JSON, test error on valid JSON that doesn't match the schema.

---

### Step 21: Implement SessionStorage Protocol & JSONL Implementation

**Context:** Storage abstraction so sessions can use different backends (filesystem, in-memory for tests, potentially S3/R2). The JSONL implementation writes to a per-session `.jsonl` file.

**What to build (in `packages/agent/src/session/storage.ts`):**

- `SessionStorage` interface:
  ```ts
  interface SessionStorage {
    append(entry: SessionEntry): Promise<void>;
    readAll(): Promise<SessionEntry[]>;
  }
  ```
- `InMemorySessionStorage` — `readAll()` returns stored entries array; useful for testing
- `FsSessionStorage` — wraps a file path:
  - `append(entry)`: open file in append mode (`a+`), write line, fsync, close
  - `readAll()`: read entire file, parse JSONL, return entries
  - Uses `Bun.file(path)` for efficient I/O

**Testing:** Test append then read with `InMemorySessionStorage`. Test `FsSessionStorage` with temp files (create, append multiple entries, read back, verify order and content).

---

### Step 22: Implement Tree Traversal & Branch Navigation

**Context:** Session entries form a directed acyclic graph through `parentId` links. The `LeafEntry` marks the current tip of the active branch. Tree traversal walks from leaf to root to reconstruct the active path.

**What to build (in `packages/agent/src/session/tree.ts`):**

- `entriesById(entries: SessionEntry[]): Map<string, SessionEntry>` — index entries, reject duplicates
- `pathToEntry(entries: SessionEntry[], leafId: string): SessionEntry[]`:
  1. Start from entry with `id === leafId`
  2. Walk `parentId` chain to root
  3. Reverse to get root→leaf order
  4. Return the path entries
- `activeLeafId(entries: SessionEntry[]): string | null` — find the last `LeafEntry` and return its `entryId`
- `branchableEntries(entries: SessionEntry[]): SessionEntry[]` — return entries that can be branched from (message entries and their user-message parents)

**Testing:** Build a small tree (root → message → message → leaf), test `pathToEntry()` returns correct root-to-leaf path, test `activeLeafId()` returns the last leaf's target, test branching from a mid-tree entry.

---

### Step 23: Implement SessionState Reconstruction

**Context:** `SessionState` is the runtime state reconstructed by replaying session entries. It produces the transcript (`AgentMessage[]`), current model, thinking level, and active leaf ID. Compaction entries are resolved by replacing old messages with summary messages.

**What to build (in `packages/agent/src/session/state.ts`):**

```ts
interface SessionState {
  messages: AgentMessage[];
  model: string;
  thinkingLevel: string;
  label?: string;
  activeLeafId: string | null;
  sessionInfo?: SessionInfoEntry;
  compactionEntries: CompactionEntry[];
}
```

**`SessionState.fromEntries(entries: SessionEntry[], leafId?: string): SessionState`**:
1. Determine active leaf ID (given or from last LeafEntry)
2. Walk path from leaf to root via `pathToEntry()`
3. Replay entries along the path:
   - `MessageEntry` → append message to transcript
   - `ModelChangeEntry` → set current model
   - `ThinkingLevelChangeEntry` → set thinking level
   - `CompactionEntry`:
     - For each `replacesEntryId`, remove the corresponding message from transcript (or mark as replaced)
     - Insert a synthetic `UserMessage("Previous conversation summary:\n<summary>")` at the compaction point
     - Keep messages that appeared AFTER the compaction in chronological order
   - `BranchSummaryEntry` → append a synthetic `UserMessage` with the branch summary
   - `LabelEntry` → set label
   - `SessionInfoEntry` → set session info
   - `CustomEntry` → collect for later use
   - `LeafEntry` → track leaf position
4. Return assembled `SessionState`

**Testing:** Create entries that simulate: normal conversation, conversation with compaction, conversation with branch switch + branch summary, conversation with model/thinking changes. Verify each reconstructs correctly.

---

## Phase 6 — Coding Tools (`alpha-coding`)

### Step 24: Define Coding Tool Interfaces & Framework

**Context:** Coding tools (`read`, `write`, `edit`, `bash`) operate on the user's filesystem and shell. They implement the `AgentTool` interface but add coding-specific metadata (working directory, prompt snippets, guidelines for the system prompt).

**What to build (in `packages/coding/src/tools/types.ts`):**

- `CodingTool` interface extends `AgentTool` with:
  - `promptSnippet: string` — short description for the system prompt
  - `promptGuidelines: string` — usage guidelines for the system prompt
- `ToolDefinition` — a factory configuration object:
  ```ts
  interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: JSONObject;
    promptSnippet: string;
    promptGuidelines: string;
    create: (cwd: string) => CodingTool;
  }
  ```
- `createCodingTools(cwd: string): CodingTool[]` — creates the four built-in tools bound to a working directory

**Testing:** Verify that `createCodingTools()` returns four tools with correct names, schemas, and prompt metadata.

---

### Step 25: Implement Read Tool

**Context:** The `read` tool reads files from the filesystem. It supports text files (UTF-8) and images (base64). It has `offset` and `limit` parameters for partial reads, and truncates output (2000 lines / 50KB) with a continuation hint.

**What to build (in `packages/coding/src/tools/read.ts`):**

- `createReadTool(cwd: string): CodingTool`
- Resolve file paths relative to `cwd` (reject paths outside `cwd` or absolute paths)
- Text files: read with `Bun.file(fullPath).text()`, handle encoding errors
- Image files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`): read as base64, return as image data
- `offset`: line number (1-indexed), default 1
- `limit`: max lines, default 2000
- Output truncation: if > 2000 lines or > 50KB, truncate with `"... [truncated — N lines / M KB total]"` hint
- Return `AgentToolResult` with `ok: true`, `content` as the file content, `data` with `{ path, totalLines, displayedLines, truncated, fileType }`
- Errors: file not found → `ok: false`, permission denied → `ok: false`, etc.

**Testing:** Create temp files, test reading full file, reading with offset/limit, test truncation on large files, test image reading returns base64, test error on nonexistent file, test path traversal rejection.

---

### Step 26: Implement Write & Edit Tools

**Context:** `write` creates/overwrites files. `edit` applies exact text replacements. Both are critical tools that need atomicity and correctness guarantees.

**Write tool (in `packages/coding/src/tools/write.ts`):**
- `createWriteTool(cwd: string): CodingTool`
- Input schema: `{ filePath: string, content: string }`
- Create parent directories if they don't exist
- Write content using `Bun.write(fullPath, content)`
- Path traversal protection
- Return result with `{ filePath, bytesWritten }`

**Edit tool (in `packages/coding/src/tools/edit.ts`):**
- `createEditTool(cwd: string): CodingTool`
- Input schema: `{ filePath: string, edits: Array<{ oldText: string, newText: string }> }`
- Algorithm:
  1. Read the file
  2. Validate each edit: `oldText` must be non-empty
  3. For each edit, find `oldText` in file content — must be found exactly once (unique match)
  4. Apply all edits (from last to first to preserve positions, or use offset tracking)
  5. Write the modified content back
- **Rollback:** If any edit fails (not found or not unique), do NOT write anything. Return error with details.
- Return result with `{ filePath, appliedEdits: number, patch?: string }` (unified diff)
- **Create a backup file** (`<path>.tau.bak`) before writing, for recovery

**Testing:**
- Write: basic file creation, overwrite existing, create nested directories, reject path traversal
- Edit: single replacement, multiple replacements, failure when oldText not found, failure when oldText matches multiple locations, rollback verification (file unchanged after failed edit), LF normalization

---

### Step 27: Implement Bash Tool

**Context:** The `bash` tool executes shell commands and captures their output. It supports timeouts, cancellation (kills process group), and output truncation (2000 lines / 50KB).

**What to build (in `packages/coding/src/tools/bash.ts`):**

- `createBashTool(cwd: string): CodingTool`
- Input schema: `{ command: string, timeout?: number }` (timeout in ms, default 120000)
- Implementation using `Bun.spawn()`/`Bun.spawnSync()` or `child_process`:
  - Run command in `cwd` with shell: `true`
  - Capture stdout and stderr
  - Apply timeout — if exceeded, kill the process and its children
  - On cancellation (`signal.isCancelled()`): kill process group
  - Truncate output to 2000 lines / 50KB, write full output to a temp `.log` file, include log path in result
  - Return `AgentToolResult` with `ok: exitCode === 0`, `content` as stdout+stderr, `details` with `{ exitCode, timedOut, logPath }`
- Process group killing: use `process.kill(-pid, signal)` if available

**Testing:** Test basic command execution (echo, ls), test stdout capture, test exit code reporting (false command → exitCode=1), test timeout (sleep 10 with 100ms timeout), test cancellation mid-execution, test output truncation, test large output writes to log file.

---

## Phase 7 — Application Foundation (`alpha-coding`)

### Step 28: Implement Configuration Management & Paths

**Context:** Tau/Pi have canonical filesystem paths for durable state. Alpha needs the same: a home directory (`~/.alpha/`), sessions dir, skills dir, prompts dir, config files.

**What to build (in `packages/coding/src/config/paths.ts`):**

- `AlphaPaths` — computed from home directory:
  - `home`: `~/.alpha`
  - `agentsHome`: `~/.agents`
  - `sessionsDir`: `~/.alpha/sessions`
  - `logsDir`: `~/.alpha/logs`
  - `userSkillsDir`: `~/.alpha/skills`
  - `userPromptsDir`: `~/.alpha/prompts`
  - `userAgentsMd`: `~/.alpha/AGENTS.md`
  - `providersFile`: `~/.alpha/providers.json`
  - `credentialsFile`: `~/.alpha/credentials.json`
  - `tuiSettingsFile`: `~/.alpha/tui.json`
  - `projectSessionDir(cwd: string)`: `~/.alpha/sessions/<slugified-cwd>-<hash6>/`
  - `defaultSessionPath(cwd: string)`: `<projectSessionDir>/default.jsonl`
  - `projectHash(cwd: string)`: 6-char hex hash of the resolved path
- Use `os.homedir()` for cross-platform home directory
- Ensure directories exist on first access (lazy creation)

**Testing:** Test path computation, test project hash is deterministic, test slugification of paths.

---

### Step 29: Implement Credential Store

**Context:** API keys and OAuth credentials are stored in `~/.alpha/credentials.json` with restricted permissions (0600). The credential store supports get/set/delete for both API keys and OAuth tokens.

**What to build (in `packages/coding/src/config/credentials.ts`):**

- `CredentialStore` interface:
  ```ts
  interface CredentialStore {
    get(name: string): Promise<string | undefined>;
    set(name: string, value: string): Promise<void>;
    getOAuth(name: string): Promise<OAuthCredential | undefined>;
    setOAuth(name: string, cred: OAuthCredential): Promise<void>;
    delete(name: string): Promise<void>;
  }
  ```
- `OAuthCredential` — `{ accessToken: string, refreshToken?: string, expiresAt?: number, accountId?: string }`
- `FileCredentialStore` implements `CredentialStore`:
  - Reads/writes `~/.alpha/credentials.json` with `{ apiKeys: Record<string,string>, oauth: Record<string,OAuthCredential> }`
  - On write: set file permissions to `0o600` (owner read/write only)
  - On read: handle missing file gracefully (return empty)
  - Atomic writes: write to temp file, rename over target

**Testing:** Test set/get API keys, test set/get OAuth credentials, test delete, test file permissions, test missing file handling, test concurrent read/write safety.

---

### Step 30: Implement Provider Configuration

**Context:** `~/.alpha/providers.json` stores named provider configurations (API key env vars, base URLs, models, thinking settings, scoped models). The provider config module loads, saves, and validates these settings.

**What to build (in `packages/coding/src/config/providers.ts`):**

- Provider config types (Zod schemas):
  - `OpenAICompatibleProviderConfig`: `{ kind: "openai_compatible", name: string, baseUrl: string, apiKeyEnv?: string, credentialName?: string, models: string[], defaultModel: string, contextWindows?: Record<string,number>, headers?: Record<string,string>, timeoutSeconds?: number, maxRetries?: number, maxRetryDelaySeconds?: number, thinkingLevels?: string[], thinkingModels?: string[], thinkingParameter?: string }`
  - `AnthropicProviderConfig`: similar + `thinkingBudgetTokens?: number`
  - `OpenAICodexProviderConfig`: similar + OAuth-specific fields
- `ProviderSettings`: `{ defaultProvider: string, providers: ProviderConfig[], scopedModels: Array<{ provider: string, model: string }> }`
- `builtinProviderCatalog: ProviderConfig[]` — built-in defaults for common providers (OpenAI, Anthropic, OpenRouter, etc.)
- `loadProviderSettings(): ProviderSettings` — load from file, merge with built-in catalog
- `saveProviderSettings(settings: ProviderSettings): Promise<void>` — atomic write
- `upsertProvider(settings: ProviderSettings, config: ProviderConfig): ProviderSettings` — merge or add
- `resolveProviderSelection(settings: ProviderSettings, providerName?: string, model?: string)` — resolve provider + model from settings

**Testing:** Test loading with no file (uses built-in defaults), test saving and reloading, test upsert (update existing, add new), test model resolution, test scoped models persistence.

---

### Step 31: Implement Skills Loading & Expansion

**Context:** Skills are markdown files loaded from `~/.alpha/skills/`, `~/.agents/skills/`, `<cwd>/.alpha/skills/`, `<cwd>/.agents/skills/`. They follow the agentskills.io format (YAML frontmatter with `name` and `description`). Skills are injected into prompts via `/skill:name [request]` and indexed in the system prompt.

**What to build (in `packages/coding/src/resources/skills.ts`):**

- `Skill` — `{ name: string, description: string, content: string, path: string }`
- `loadSkills(paths: string[]): Skill[]`:
  - Search directories in priority order (project-local overrides user)
  - Find files: `*.md` files and `<dir>/SKILL.md`
  - Parse frontmatter (simple `key: value` pairs between `---` markers)
  - Skip skill files named `SKILL.md` that have `disableModelInvocation: true`
  - Deduplicate by name (higher priority wins)
- `expandSkillInvocation(text: string, skills: Skill[]): string | null`:
  - Match `/skill:name [additional instructions]`
  - Format as XML block:
    ```xml
    <skill name="name" location="path">
    <skill content>
    </skill>
    
    Additional instructions...
    ```
- `formatSkillsForSystemPrompt(skills: Skill[]): string`:
  - Generate `<available_skills>` XML block listing all skills with name, description, location
  - Only include if the `read` tool is available (agent needs to read skill files)

**Testing:** Test loading from directories, test frontmatter parsing, test deduplication (project-local wins), test skill expansion formats XML correctly, test system prompt skill index, test `disableModelInvocation` filtering, test empty/no skills directory.

---

### Step 32: Implement Prompt Templates

**Context:** Prompt templates are markdown files with `{{ variable }}` placeholders, loaded from similar directory hierarchies. Invoked via `/template-name args` in the TUI. Templates support `{{ arguments }}` for the combined args string.

**What to build (in `packages/coding/src/resources/templates.ts`):**

- `PromptTemplate` — `{ name: string, description?: string, content: string, path: string }`
- `loadPromptTemplates(paths: string[]): PromptTemplate[]` — similar to skills loading
- `renderPromptTemplate(template: PromptTemplate, variables: Record<string, string>): string`:
  - Replace `{{ name }}` with variable values
  - Handle `{{ arguments }}` / `{{ args }}` as special variables
  - Missing variables: warn or use empty string
- `expandTemplateInvocation(text: string, templates: PromptTemplate[]): string | null`:
  - Match `/template-name [...args]`
  - If template has no `{{ arguments }}` references, append args after template content
  - If template has `{{ arguments }}`, substitute and return

**Testing:** Test template loading, test variable substitution, test `{{ arguments }}` behavior, test template expansion via slash command matching, test missing variable handling.

---

### Step 33: Implement System Prompt Assembly

**Context:** The system prompt is built dynamically from tools, project context files (`AGENTS.md`), skills, custom prompts, and current date/cwd. It tells the model what it can do and how to behave.

**What to build (in `packages/coding/src/prompt/system.ts`):**

```ts
interface BuildSystemPromptOptions {
  cwd: string;
  tools: CodingTool[];
  skills: Skill[];
  customPrompt?: string;
  appendPrompt?: string;
  contextFiles?: Array<{ path: string; content: string }>;
  currentDate?: string;
  extraGuidelines?: string;
}
```

**`buildSystemPrompt(opts: BuildSystemPromptOptions): string`** assembles:

1. **Role introduction:** "You are an expert coding assistant operating inside Alpha... You have access to tools to read, write, edit files and run shell commands."
2. **Available tools:** For each tool with `promptSnippet`, list: `- read(filePath, offset?, limit?) - Read a file from disk`
3. **Tool guidelines:** Collect all `promptGuidelines` from tools, deduplicate, format as numbered list
4. **Custom prompt:** If `customPrompt` is set, replace sections 1-3 with it (but still include append and context)
5. **Append prompt:** If `appendPrompt` is set, add after guidelines
6. **Project context:** For each `contextFiles`, format as:
   ```xml
   <context name="path">
   content
   </context>
   ```
7. **Skills index:** If `read` tool is available, include `<available_skills>` XML (from `formatSkillsForSystemPrompt`)
8. **Date and CWD:** "Current date: YYYY-MM-DD. Working directory: /path/to/project"

**Testing:** Test default prompt includes tools/guidelines/date/cwd, test custom prompt replaces default but keeps append and context, test empty custom prompt suppresses default, test skills index only included when read tool present, test context file inclusion, test deduplication of guidelines.

---

## Phase 8 — Context & Thinking (`alpha-coding`)

### Step 34: Implement Project Context Discovery

**Context:** `AGENTS.md` files provide project-specific instructions to the agent. They are discovered from: home directory, project root (nearest ancestor with `.git` or `package.json`), and local `.alpha/AGENTS.md` / `.agents/AGENTS.md`. Multiple files can combine (home + project + local).

**What to build (in `packages/coding/src/context/discovery.ts`):**

- `ProjectContextFile` — `{ path: string; content: string; source: "home" | "project" | "local" }`
- `discoverProjectContext(cwd: string): ProjectContextFile[]`:
  1. Check `~/.alpha/AGENTS.md`
  2. Check `~/.agents/AGENTS.md` (lower priority than ~/.alpha/)
  3. Find project root: walk up from `cwd` looking for `.git`, `package.json`, `tsconfig.json`, etc.
  4. Check `<project-root>/AGENTS.md`
  5. Also check `<project-root>/.alpha/AGENTS.md` and `<project-root>/.agents/AGENTS.md`
  6. Check `<cwd>/.alpha/AGENTS.md` and `<cwd>/.agents/AGENTS.md`
  7. Deduplicate by content hash (identical files appear once)
  8. Return sorted by priority (local overrides project overrides home)

**Testing:** Create temp project structure with various AGENTS.md files, test discovery order and deduplication, test empty project (no context files), test priority (local beats project beats home).

---

### Step 35: Implement Token Estimation

**Context:** Tau uses deterministic `ceil(chars/4)` token estimation (not a tokenizer) for context accounting. This feeds into auto-compaction decisions and the `/session` status display.

**What to build (in `packages/coding/src/context/tokens.ts`):**

- `estimateTextTokens(text: string): number` — `Math.max(1, Math.ceil(text.length / 4))`
- `estimateMessageTokens(msg: AgentMessage): number` — role overhead (4) + content tokens + tool call overhead
- `estimateToolTokens(tool: AgentTool): number` — overhead (16) + name + description + schema
- `estimateContextTokens(system: string, messages: AgentMessage[], tools: AgentTool[]): ContextUsageEstimate`
- `ContextUsageEstimate` — `{ systemTokens, messageTokens, toolTokens, totalTokens, messageCount, toolCount }`
- `autoCompactionThreshold(contextWindowTokens: number): number | null`:
  - `contextWindow - 16384` (Pi-style reserve)
  - Clamp to at least 1
  - If context window is 0 → return null (disabled)
- `DEFAULT_CONTEXT_WINDOW`: 128000 (fallback for unknown models)

**Testing:** Test `estimateTextTokens` with edge cases (empty, single char, exact multiples), test message estimation with different message types, test tool estimation, test `autoCompactionThreshold` formula, test unknown model fallback.

---

### Step 36: Implement Context Compaction

**Context:** When the estimated context exceeds the threshold, the agent generates a structured summary of the conversation so far, replacing older messages with a compact summary. This keeps long sessions usable. Compaction preserves recent messages (20K tokens) and summarizes older ones.

**What to build (in `packages/coding/src/context/compaction.ts`):**

- `summarizeMessagesForCompaction(messages: AgentMessage[]): string` — deterministic fallback summary:
  ```
  Automatically compacted N prior message(s):
  1. [User]: ...
  2. [Assistant]: ...
  ...
  ```
- `buildCompactionPrompt(messages: AgentMessage[], customInstructions?: string): string` — structured format:
  ```
  <conversation>
  [serialized messages]
  </conversation>
  
  Summarize in this format:
  ## Goal
  ## Constraints
  ## Progress
    ### Done
    ### In Progress
    ### Blocked
  ## Key Decisions
  ## Next Steps
  ## Critical Context
  ```
- `serializeMessagesForCompaction(messages: AgentMessage[]): string` — XML-like format preserving roles and content
- `buildUpdateCompactionPrompt(previousSummary: string, newMessages: AgentMessage[], customInstructions?: string): string` — for iterative compaction (wraps previous summary in `<previous-summary>`)
- `recentPreservingCompactionPlan(messages: AgentMessage[], keepTokens: number = 20000): { keep: AgentMessage[], compact: AgentMessage[] }` — identifies which messages to keep and which to compact

**Testing:** Test deterministic fallback summary, test PI-format prompt building, test update prompt with previous summary, test compaction plan partition (keeps recent, compacts old), test serialized message format, test with custom instructions.

---

### Step 37: Implement Thinking Mode Controls

**Context:** Some models support "thinking" (extended reasoning). Thinking levels map to provider-specific parameters: `"off"` → no thinking, `"low"` through `"xhigh"` → increasing budget. The thinking level is persisted as a session entry and affects the runtime provider configuration.

**What to build (in `packages/coding/src/thinking.ts`):**

- `ThinkingLevel` — `"off" | "minimal" | "low" | "medium" | "high" | "xhigh"`
- `normalizeThinkingLevel(level: string | undefined, defaultLevel?: ThinkingLevel): ThinkingLevel` — case-insensitive normalization; undefined → default level
- `nextThinkingLevel(current: ThinkingLevel, available: ThinkingLevel[]): ThinkingLevel` — cycle through available levels, wrap around
- `reasoningEffortForLevel(level: ThinkingLevel): string` — maps to OpenAI reasoning effort (`off→"none"`, rest as-is)
- `anthropicThinkingBudgetForLevel(level: ThinkingLevel): number | null` — maps to token budget (off→null, minimal=1024, low=2048, medium=4096, high=8192, xhigh=16384)
- `providerThinkingLevels(providerConfig: ProviderConfig): ThinkingLevel[]` — returns supported thinking levels for a provider/model

**Testing:** Test normalization (case insensitive), test `nextThinkingLevel` cycling and wrap-around, test reasoning effort mapping, test Anthropic budget mapping, test provider thinking level extraction.

---

## Phase 9 — CodingSession (`alpha-coding`)

### Step 38: Implement CodingSession (Core Orchestrator)

**Context:** `CodingSession` is the central class that ties everything together: harness, tools, storage, skills, context files, provider management, compaction, and commands. It's the bridge between the reusable agent brain and the coding-specific environment.

**What to build (in `packages/coding/src/session.ts`):**

```ts
class CodingSession {
  // Construction
  constructor(config: CodingSessionConfig, state: SessionState);
  static async load(config: CodingSessionConfig): Promise<CodingSession>;
  
  // Core API
  get cwd(): string;
  get model(): string;
  get providerName(): string;
  get tools(): CodingTool[];
  get messages(): readonly AgentMessage[];
  get state(): SessionState;
  get thinkingLevel(): ThinkingLevel;
  get contextTokenEstimate(): ContextUsageEstimate;
  get isRunning(): boolean;
  get sessionId(): string;
  
  async *prompt(content: string): AsyncIterable<AgentEvent>;
  async *continue_(): AsyncIterable<AgentEvent>;
  
  // Model/Provider management
  async setModel(model: string): Promise<void>;
  async setProvider(providerName: string): Promise<void>;
  async setThinkingLevel(level: ThinkingLevel): Promise<void>;
  
  // Session operations
  async compact(instructions?: string): Promise<void>;
  async reload(): Promise<void>;
  async resume(sessionId: string): Promise<void>;
  async newSession(): Promise<void>;
  
  // Commands
  async handleCommand(text: string): Promise<CommandResult>;
  
  // Terminal commands
  async runTerminalCommand(command: string, addToContext: boolean): Promise<void>;
  
  // Prompt expansion
  expandPromptText(text: string): string;  // expands skills + templates
}
```

**`CodingSession.load(config)` flow:**
1. Read all entries from storage
2. If empty: create `SessionInfoEntry`, `ModelChangeEntry`, `ThinkingLevelChangeEntry`
3. Replay via `SessionState.fromEntries()`
4. Load tools: `createCodingTools(config.cwd)`
5. Load resources: skills, prompt templates, context files
6. Build system prompt (or use explicit)
7. Create `AgentHarness` with provider, model, system, tools
8. Wire up persistence: subscribe to harness events, persist messages on `MessageEndEvent`
9. Return instance

**`prompt(content)` flow:**
1. Check harness is not running (queue as steer if running)
2. Expand prompt (skills, templates)
3. Check auto-compaction threshold
4. Delegate to `harness.prompt(content)`
5. On `MessageEndEvent`: persist message entry + leaf entry to storage
6. Handle context overflow errors: compact and retry once

**Testing (integration tests):**
- Load empty session: state has default tools, model, thinking level; transcript file deferred
- Load existing session: messages are restored into harness
- Prompt persists user + assistant + leaf entries
- Tool results are persisted
- Continue persists only new messages
- Auto-compaction triggers when threshold exceeded
- Context overflow triggers compaction + single retry
- Provider switching, model switching, thinking level changing

---

### Step 39: Implement Session Persistence & Tree Branching

**Context:** Extend `CodingSession` with the tree branching and full persistence model. Messages are persisted at `MessageEndEvent` boundaries (durable message boundary). The session tree supports branching to any previous entry without destroying history.

**What to build (extend `CodingSession`):**

- `_persistMessagesSince(count: number): Promise<void>` — create `MessageEntry` + `LeafEntry` for each new harness message
- `_appendSessionEntry(entry: SessionEntry): Promise<void>` — flush initial entries, write to storage
- `_refreshPersistedState(): Promise<void>` — re-read entries, reconstruct `SessionState`
- `treeChoices(): BranchChoice[]` — return branchable entries for tree picker:
  ```ts
  { entryId: string, parentId: string | null, summary: string, indent: number }
  ```
- `async branchTo(entryId: string, summarize?: boolean, customInstructions?: string): Promise<void>`:
  1. If `summarize`: generate branch summary via model, persist `BranchSummaryEntry`
  2. Create new `LeafEntry` pointing to `entryId`
  3. Reload state from entries (along new branch path)
  4. Rebuild harness transcript from the branch's messages
  5. Handle orphaned entries (missing parent → re-root)

**Testing:** Test message persistence on each `MessageEndEvent`, test leaf entries track active branch, test branching creates new leaf without deleting old entries, test branching with summary, test branching to before a user message (prefill input), test tree choices indent only diverged branches, test branch restores correct model/thinking from path.

---

### Step 40: Implement Session Manager

**Context:** The session manager indexes sessions on disk, tracks metadata (cwd, model, title, created_at, updated_at), and supports resume, new-session, and listing operations.

**What to build (in `packages/coding/src/session-manager.ts`):**

```ts
interface SessionRecord {
  id: string;
  cwd: string;
  path: string;
  model: string;
  providerName: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

class SessionManager {
  constructor(paths: AlphaPaths);
  
  listSessions(cwd?: string): SessionRecord[];
  latestSessionForCwd(cwd: string): SessionRecord | undefined;
  createSession(cwd: string, model: string, providerName: string, title?: string): SessionRecord;
  getDefaultSession(cwd: string, model: string, providerName: string): SessionRecord;
  touchSession(sessionId: string, updates: Partial<SessionRecord>): void;
  getSession(sessionId: string): SessionRecord | undefined;
}
```

- Index stored as `~/.alpha/sessions/index.jsonl` (one JSON object per line, one per session)
- Sessions stored under `~/.alpha/sessions/<cleaned-path>-<hash6>/` with `default.jsonl` or `<id>.jsonl`
- `createSession()` creates the directory and generates a new session ID
- `touchSession()` updates `updatedAt` and merges updates
- Sorted by `updatedAt` descending

**Testing:** Test session creation, test listing filters by cwd, test latest session for cwd, test touch updates metadata and updatedAt, test resume loads another session's transcript, test new session creates fresh transcript with same cwd.

---

## Phase 10 — CLI & TUI (`alpha-coding`)

### Step 41: Implement Basic CLI with Print Mode

**Context:** The CLI is the entry point for Alpha. It supports subcommands, non-interactive print mode (`alpha -p "prompt"`), and provider/model overrides. Uses a lightweight CLI library (yargs, commander, or simple argument parser).

**What to build (in `packages/coding/src/cli.ts`):**

- CLI entry point with:
  - Default: TUI mode (placeholder for now, prints "TUI not yet implemented")
  - `-p, --prompt <text>`: Non-interactive print mode
  - `--provider <name>`: Override default provider
  - `--model <name>`: Override default model
  - `--cwd <path>`: Set working directory
  - `--resume`: Resume last session
  - `--new-session`: Start fresh session
  - `--output <format>`: Output format (`text`, `json`, `transcript`)
- `sessions` subcommand: List sessions
- `export` subcommand: Export session to HTML/JSONL
- Wire up: load provider settings → resolve provider → create runtime provider → create `CodingSession` → stream events → render

**Run command:** `alpha` in global install or `bun run packages/coding/src/cli.ts` during development.

**Testing:** Test CLI argument parsing, test print mode outputs final text, test provider/model override, test --output flag with different formats, test sessions subcommand.

---

### Step 42: Implement Event Renderers

**Context:** Event renderers translate `AgentEvent` streams into human-readable output for non-interactive modes. Three renderers: text (final output only), JSON (JSONL event stream), transcript (human-readable streaming).

**What to build (in `packages/coding/src/rendering/`):**

- `EventRenderer` interface:
  ```ts
  interface EventRenderer {
    render(event: AgentEvent): void;
    finish(): boolean;  // returns true if anything was output
  }
  ```
- `FinalTextRenderer`: Records the last assistant message text, outputs it on `finish()`
- `JsonEventRenderer`: Outputs each event as a JSONL line to stdout
- `TranscriptRenderer`: Streams text deltas in real-time to stdout with role markers and tool output to stderr
  ```
  [Assistant]
  text content streaming in real time...
  ```
- `createEventRenderer(format: string): EventRenderer` — factory

**Testing:** Test each renderer with a simulated event stream, verify text renderer outputs only final message, verify JSON renderer outputs valid JSONL, verify transcript renderer outputs deltas in order.

---

### Step 43: Implement Basic Ink TUI — Layout & Prompt

**Context:** Using Ink (React-for-CLI), build a basic TUI with a prompt input area, a scrollable transcript area, and a status bar. This step focuses on layout, prompt input, and slash command handling — no agent integration yet.

**What to build (in `packages/coding/src/tui/app.tsx`):**

- `AlphaTuiApp` — Ink application:
  - **Layout (terminal-like):**
    - Top: transcript area (scrollable `Box` with `flexGrow: 1`)
    - Middle: prompt input area (`TextInput` or `StdinContext`-based input)
    - Bottom: status bar (provider, model, thinking level, context tokens)
  - **Prompt input:**
    - Multi-line support (`Shift+Enter` for newline)
    - `Enter` submits
    - Detect slash commands (words starting with `/`)
  - **Status bar:** Shows `provider:model | thinking:level | context: N tokens`
- State management with `useState`:
  - `messages: ChatMessage[]` — display messages
  - `input: string` — current prompt
  - `status: { provider, model, thinking, tokens }`

**Testing:** Manual testing in terminal: type text, submit, verify display, test slash command detection.

---

### Step 44: Implement Streaming Transcript View in Ink

**Context:** Wire up the agent to the TUI. Show streaming text deltas, tool execution status, thinking tokens (collapsible), and support slash commands, model cycling, and cancellation.

**What to build (extend/refactor TUI):**

- **Agent integration:** When user submits prompt:
  1. Expand skills/templates
  2. Call `session.prompt(text)`
  3. Iterate events and update React state:
     - `MessageDeltaEvent` → append text to current assistant message
     - `ThinkingDeltaEvent` → append to thinking block
     - `ToolExecutionStartEvent` → show "Running tool: name..."
     - `ToolExecutionEndEvent` → show tool result (collapsible)
     - `RetryEvent` → show retry status
     - `ErrorEvent` → show error message
     - `MessageEndEvent` → finalize message display
  4. Use `useAgentLoop` hook that manages the async iteration within React's rendering cycle
- **Chat display:** Messages rendered as color-coded blocks:
  - User messages: dim color
  - Assistant messages: bright color
  - Tool results: collapsible, dim color
  - Errors: red
  - Thinking: collapsible, italic
- **Keybindings:**
  - `Escape`: cancel current run
  - `Ctrl+C` / `Ctrl+D`: quit
  - `Ctrl+P`: cycle scoped models
  - `Shift+Tab`: cycle thinking
- **Slash commands:** `/quit`, `/model`, `/reload`, `/compact`, `/session`, `/resume`, `/tree`, `/export`, `/thinking`
- **Terminal commands:** `!` prefix for shell commands, `!!` for hidden (no context addition)

**Testing:** Manual testing. Write unit tests for keybindings handling, slash command parsing, message rendering logic.

---

## Phase Overview

| Phase | Steps | Package | What |
|---|---|---|---|
| 1 — Foundation | 1–4 | root + `agent` | Monorepo, JSON types, messages, tools |
| 2 — Provider Layer | 5–9 | `ai` | Provider protocol, events, FakeProvider, OpenAI, Anthropic |
| 3 — Agent Loop | 10–14 | `agent` | Agent events, loop, tool execution, queues, cancellation |
| 4 — Agent Harness | 15–18 | `agent` | Harness, queues, listeners, cancellation/repair |
| 5 — Session Storage | 19–23 | `agent` | Entry types, JSONL, storage, tree, state reconstruction |
| 6 — Coding Tools | 24–27 | `coding` | Read, write, edit, bash tools |
| 7 — App Foundation | 28–33 | `coding` | Paths, credentials, providers, skills, templates, system prompt |
| 8 — Context | 34–37 | `coding` | Context discovery, tokens, compaction, thinking |
| 9 — CodingSession | 38–40 | `coding` | Session orchestrator, persistence, session manager |
| 10 — CLI & TUI | 41–44 | `coding` | CLI print mode, renderers, Ink TUI |

**Total: 44 steps across 10 phases.**

---

## Package Dependency Graph

```
alpha-coding
  ├── alpha-agent
  │     └── alpha-ai
  ├── zod
  ├── ink / react (TUI)
  └── commander (CLI)

alpha-agent
  ├── alpha-ai
  └── zod

alpha-ai
  └── zod (config schemas only)
```

---

## Development Guidelines

1. **Work one step at a time.** Complete the step (code + tests), verify everything passes, then move on.
2. **Tests first where practical.** The `FakeProvider` makes agent loop tests deterministic — use it.
3. **Keep the package boundary clean.** `alpha-agent` must never import from `alpha-coding` or rendering libraries. `alpha-ai` must never import from `alpha-agent` or `alpha-coding`.
4. **Use Zod for all serialized/deserialized types** (messages, events, session entries, config). Use plain TypeScript interfaces for internal types (tool executors, provider configs).
5. **Event-driven everywhere.** The agent loop, harness, and session should communicate through events. The TUI consumes events.
6. **Run `bun test` and `bun run typecheck` after every step.** Fix all errors before proceeding.
7. **Commit after each step** with a descriptive message referencing the step number.
8. **When stuck on a concept**, re-read the corresponding Tau source file and test for reference implementation details.
