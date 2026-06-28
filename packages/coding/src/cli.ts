import { parseArgs } from "node:util";
import { FakeProvider } from "@alpha/ai";
import { InMemorySessionStorage } from "@alpha/agent";
import { CodingSession, type CodingSessionConfig } from "./session.ts";
import { SessionManager } from "./session-manager.ts";
import { createCodingTools } from "./tools/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OutputFormat = "text" | "json" | "transcript";

interface ParsedArgs {
  prompt?: string;
  provider?: string;
  model?: string;
  cwd?: string;
  resume?: boolean;
  newSession?: boolean;
  output?: OutputFormat;
  subcommand?: string;
  subArgs?: string[];
}

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

function parseCliArgs(argv: string[]): ParsedArgs {
  // Check for subcommands first
  const subcommand = argv[0];
  if (subcommand && !subcommand.startsWith("-")) {
    return { subcommand, subArgs: argv.slice(1) };
  }
  if (argv.length === 0) return {};

  const { values } = parseArgs({
    args: argv,
    options: {
      prompt: { type: "string", short: "p" },
      provider: { type: "string" },
      model: { type: "string" },
      cwd: { type: "string" },
      resume: { type: "boolean" },
      "new-session": { type: "boolean" },
      output: { type: "string" },
    },
    strict: false,
    allowPositionals: false,
  });

  return {
    prompt: values.prompt as string | undefined,
    provider: values.provider as string | undefined,
    model: values.model as string | undefined,
    cwd: values.cwd as string | undefined,
    resume: (values.resume as boolean) ?? false,
    newSession: (values["new-session"] as boolean) ?? false,
    output: values.output as OutputFormat | undefined,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(args);

  // Subcommands
  if (parsed.subcommand === "sessions") {
    await handleSessions();
    return;
  }
  if (parsed.subcommand === "export") {
    handleExport(parsed.subArgs ?? []);
    return;
  }

  // Print mode
  if (parsed.prompt) {
    await handlePrintMode(parsed);
    return;
  }

  // Default: TUI placeholder
  console.log("Alpha — A TypeScript coding-agent harness");
  console.log("TUI not yet implemented. Use -p 'prompt' for print mode.");
  console.log("");
  console.log("Usage:");
  console.log("  alpha -p 'your prompt'     Non-interactive print mode");
  console.log("  alpha --provider openai     Set provider");
  console.log("  alpha --model gpt-4         Set model");
  console.log("  alpha --output json         Output format (text, json, transcript)");
  console.log("  alpha sessions              List sessions");
  console.log("  alpha export [path]         Export session");
}

// ---------------------------------------------------------------------------
// Print mode
// ---------------------------------------------------------------------------

async function handlePrintMode(args: ParsedArgs): Promise<void> {
  const cwd = args.cwd ?? process.cwd();
  const model = args.model ?? "fake";
  const outputFormat = args.output ?? "text";

  // Create a simple provider for the demo
  const provider = FakeProvider.singleTextResponse("Hello from Alpha! This is a demo response.");

  const config: CodingSessionConfig = {
    provider,
    model,
    cwd,
    storage: new InMemorySessionStorage(),
    providerName: args.provider ?? "default",
  };

  const session = await CodingSession.load(config);
  const events = session.prompt(args.prompt!);

  for await (const event of events) {
    switch (outputFormat) {
      case "json":
        console.log(JSON.stringify(event));
        break;
      case "transcript":
        if (event.type === "message_delta") {
          process.stdout.write((event as { text: string }).text);
        }
        break;
      case "text":
      default:
        if (event.type === "message_delta") {
          process.stdout.write((event as { text: string }).text);
        }
        break;
    }
  }

  if (outputFormat === "text" || outputFormat === "transcript") {
    process.stdout.write("\n");
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function handleSessions(): Promise<void> {
  const manager = new SessionManager();
  const sessions = manager.listSessions();

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  for (const s of sessions) {
    console.log(`[${s.id.slice(0, 8)}] ${s.cwd} — ${s.model} (${s.updatedAt.slice(0, 16)})`);
  }
}

function handleExport(args: string[]): void {
  const dest = args[0] ?? "session.html";
  console.log(`Export not yet implemented. Would export to: ${dest}`);
}

// ---------------------------------------------------------------------------
// Run directly
// ---------------------------------------------------------------------------

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
