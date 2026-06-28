import type { AgentEvent } from "@alpha/agent";

// ---------------------------------------------------------------------------
// EventRenderer interface
// ---------------------------------------------------------------------------

export interface EventRenderer {
  render(event: AgentEvent): void;
  /** Returns true if anything was output. */
  finish(): boolean;
}

// ---------------------------------------------------------------------------
// FinalTextRenderer — outputs only the last assistant message text
// ---------------------------------------------------------------------------

export class FinalTextRenderer implements EventRenderer {
  private _lastText = "";

  render(event: AgentEvent): void {
    if (event.type === "message_end" && event.message.role === "assistant") {
      this._lastText = event.message.content;
    }
  }

  finish(): boolean {
    if (this._lastText) {
      process.stdout.write(this._lastText + "\n");
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// JsonEventRenderer — outputs each event as a JSONL line
// ---------------------------------------------------------------------------

export class JsonEventRenderer implements EventRenderer {
  private _count = 0;

  render(event: AgentEvent): void {
    process.stdout.write(JSON.stringify(event) + "\n");
    this._count++;
  }

  finish(): boolean {
    return this._count > 0;
  }
}

// ---------------------------------------------------------------------------
// TranscriptRenderer — human-readable streaming output
// ---------------------------------------------------------------------------

export class TranscriptRenderer implements EventRenderer {
  private _currentRole = "";
  private _outputCount = 0;

  render(event: AgentEvent): void {
    switch (event.type) {
      case "message_start": {
        const role = event.role;
        if (role !== this._currentRole) {
          this._currentRole = role;
          const label = role[0]!.toUpperCase() + role.slice(1);
          this._writeln(`\n[${label}]`);
        }
        break;
      }
      case "message_delta": {
        process.stdout.write(event.text);
        this._outputCount++;
        break;
      }
      case "thinking_delta": {
        process.stderr.write(`[thinking] ${event.text}\n`);
        this._outputCount++;
        break;
      }
      case "tool_execution_start": {
        if (event.call) {
          process.stderr.write(`[tool] Running: ${event.call.name}...\n`);
          this._outputCount++;
        }
        break;
      }
      case "tool_execution_end": {
        const result = event.result;
        process.stderr.write(`[tool] ${result.ok ? "OK" : "ERROR"}: ${result.name} (${result.content.slice(0, 80)})\n`);
        this._outputCount++;
        break;
      }
      case "retry": {
        process.stderr.write(`[retry] ${event.message}\n`);
        this._outputCount++;
        break;
      }
      case "error": {
        process.stderr.write(`[error] ${event.message}\n`);
        this._outputCount++;
        break;
      }
    }
  }

  finish(): boolean {
    process.stdout.write("\n");
    return this._outputCount > 0;
  }

  private _writeln(text: string): void {
    process.stdout.write(text + "\n");
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEventRenderer(format: string): EventRenderer {
  switch (format) {
    case "json": return new JsonEventRenderer();
    case "transcript": return new TranscriptRenderer();
    case "text":
    default: return new FinalTextRenderer();
  }
}
