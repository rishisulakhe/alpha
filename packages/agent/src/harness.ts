import type { ModelProvider } from "@alpha/ai";
import type { AgentMessage, AssistantMessage, ToolCall, ToolResultMessage } from "./messages.ts";
import type { AgentTool, CancellationToken } from "./tools.ts";
import { SimpleCancellationToken } from "./tools.ts";
import { runAgentLoop } from "./loop.ts";
import type {
  AgentEvent,
  MessageStartEvent,
  MessageEndEvent,
  QueueUpdateEvent,
} from "./events.ts";

// ---------------------------------------------------------------------------
// AgentHarnessConfig
// ---------------------------------------------------------------------------

export interface AgentHarnessConfig {
  provider: ModelProvider;
  model: string;
  system: string;
  tools?: AgentTool[];
  maxTurns?: number;
  queueMode?: "one_at_a_time" | "all";
}

// ---------------------------------------------------------------------------
// AgentHarness
// ---------------------------------------------------------------------------

export class AgentHarness {
  private _config: AgentHarnessConfig;
  private _messages: AgentMessage[];
  private _listeners: Array<(event: AgentEvent) => void | Promise<void>> = [];
  private _currentSignal: SimpleCancellationToken | null = null;
  private _isRunning = false;
  private _steeringQueue: AgentMessage[] = [];
  private _followUpQueue: AgentMessage[] = [];

  constructor(config: AgentHarnessConfig, messages?: AgentMessage[]) {
    this._config = config;
    this._messages = messages != null ? [...messages] : [];
  }

  // -- Core API ---------------------------------------------------------------

  get messages(): readonly AgentMessage[] {
    return [...this._messages];
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  async *prompt(content: string): AsyncIterable<AgentEvent> {
    this._ensureNotRunning();
    this._repairInterruptedToolResults();

    // Drain idle steering messages before appending the new user message
    const idleSteering = this._drainAllSteering();
    for (const msg of idleSteering) {
      yield { type: "message_start", role: msg.role } satisfies MessageStartEvent;
      yield { type: "message_end", message: msg } satisfies MessageEndEvent;
    }

    this._isRunning = true;
    const userMessage: AgentMessage = { role: "user", content };
    this._messages.push(userMessage);
    yield* this._run(userMessage);
  }

  async *continue_(): AsyncIterable<AgentEvent> {
    this._ensureNotRunning();
    this._repairInterruptedToolResults();
    this._isRunning = true;
    yield* this._run();
  }

  // -- Internal run method ---------------------------------------------------

  private async *_run(promptMessage?: AgentMessage): AsyncIterable<AgentEvent> {
    const signal = new SimpleCancellationToken();
    this._currentSignal = signal;
    let pendingPromptEvent = promptMessage;

    try {
      for await (const event of runAgentLoop({
        provider: this._config.provider,
        model: this._config.model,
        system: this._config.system,
        messages: this._messages,
        tools: this._config.tools ?? [],
        maxTurns: this._config.maxTurns,
        signal,
        getSteeringMessages: () => this._drainSteeringMessages(),
        getFollowUpMessages: () => this._drainFollowUpMessages(),
        getQueueUpdate: () => ({
          steering: this._steeringQueue.map((m) => m.content),
          followUp: this._followUpQueue.map((m) => m.content),
        }),
        queueMode: this._config.queueMode,
      })) {
        this._notify(event);

        // Use await on agent_end so session writes flush before idle state is visible
        if (event.type === "agent_end") {
          await this._notifyAndAwait(event);
        }

        yield event;

        // Emit pending user message as events when the first turn starts
        if (pendingPromptEvent != null && event.type === "turn_start") {
          const msgStart: AgentEvent = {
            type: "message_start",
            role: pendingPromptEvent.role as "user" | "assistant" | "tool",
          } satisfies MessageStartEvent;
          const msgEnd: AgentEvent = {
            type: "message_end",
            message: pendingPromptEvent,
          } satisfies MessageEndEvent;
          for (const ev of [msgStart, msgEnd]) {
            this._notify(ev);
            yield ev;
          }
          pendingPromptEvent = undefined;
        }
      }
    } finally {
      if (signal.isCancelled()) {
        this._repairInterruptedToolResults();
      }
      if (this._currentSignal === signal) {
        this._currentSignal = null;
      }
      this._isRunning = false;
    }
  }

  // -- Message management ------------------------------------------------------

  appendMessage(message: AgentMessage): void {
    this._messages.push(message);
  }

  replaceMessages(messages: AgentMessage[]): void {
    this._messages = [...messages];
  }

  // -- Queue management --------------------------------------------------------

  steer(content: string): void {
    this._steeringQueue.push({ role: "user", content });
  }

  steerMessage(message: AgentMessage): void {
    this._steeringQueue.push(message);
  }

  followUp(content: string): void {
    this._followUpQueue.push({ role: "user", content });
  }

  followUpMessage(message: AgentMessage): void {
    this._followUpQueue.push(message);
  }

  clearQueues(): { steering: AgentMessage[]; followUp: AgentMessage[] } {
    const snapshot = {
      steering: [...this._steeringQueue],
      followUp: [...this._followUpQueue],
    };
    this._steeringQueue = [];
    this._followUpQueue = [];
    return snapshot;
  }

  popLatestFollowUp(): AgentMessage | undefined {
    return this._followUpQueue.pop();
  }

  get pendingMessageCount(): number {
    return this._steeringQueue.length + this._followUpQueue.length;
  }

  // -- Cancellation -----------------------------------------------------------

  cancel(): void {
    if (this._currentSignal != null) {
      this._currentSignal.cancel();
    }
  }

  // -- Listener system --------------------------------------------------------

  subscribe(listener: (event: AgentEvent) => void | Promise<void>): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  // -- Private helpers --------------------------------------------------------

  private _notify(event: AgentEvent): void {
    for (const listener of [...this._listeners]) {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          result.catch(() => {
            // Listener errors must not break the harness
          });
        }
      } catch {
        // Listener errors must not break the harness
      }
    }
  }

  private async _notifyAndAwait(event: AgentEvent): Promise<void> {
    for (const listener of [...this._listeners]) {
      try {
        await listener(event);
      } catch {
        // Listener errors must not break the harness
      }
    }
  }

  private _ensureNotRunning(): void {
    if (this._isRunning) {
      throw new Error(
        "AgentHarness is already running; use steer() or follow_up() to queue messages.",
      );
    }
  }

  private _drainSteeringMessages(): AgentMessage[] {
    return this._drainQueue(this._steeringQueue);
  }

  private _drainFollowUpMessages(): AgentMessage[] {
    return this._drainQueue(this._followUpQueue);
  }

  private _drainQueue(queue: AgentMessage[]): AgentMessage[] {
    if (queue.length === 0) return [];
    if (this._config.queueMode === "all") {
      const drained = [...queue];
      queue.length = 0;
      return drained;
    }
    // one_at_a_time
    return [queue.shift()!];
  }

  private _drainAllSteering(): AgentMessage[] {
    const drained = [...this._steeringQueue];
    this._steeringQueue = [];
    this._messages.push(...drained);
    return drained;
  }

  private _repairInterruptedToolResults(): void {
    const idx = this._latestOpenToolCallAssistantIndex();
    if (idx === null) return;

    const assistant = this._messages[idx]!;
    if (assistant.role !== "assistant" || assistant.tool_calls.length === 0) return;

    const returnedIds = new Set(
      this._messages.slice(idx + 1).filter((m) => m.role === "tool").map((m) => (m as ToolResultMessage).tool_call_id),
    );

    for (const tc of assistant.tool_calls) {
      if (returnedIds.has(tc.id)) continue;
      const msg = "Tool call interrupted by user";
      const repair: AgentMessage = {
        role: "tool",
        tool_call_id: tc.id,
        name: tc.name,
        content: msg,
        ok: false,
        error: msg,
        data: null,
        details: null,
      };
      this._messages.push(repair);
    }
  }

  private _latestOpenToolCallAssistantIndex(): number | null {
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const m = this._messages[i]!;
      if (m.role === "user") return null;
      if (m.role === "assistant") {
        return m.tool_calls.length > 0 ? i : null;
      }
    }
    return null;
  }
}
