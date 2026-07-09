import { parseArgs } from "node:util";
import { InMemorySessionStorage, FsSessionStorage } from "@alpha/agent";
import { CodingSession, type CodingSessionConfig } from "./session.ts";
import { SessionManager } from "./session-manager.ts";
import { createProvider, loadProviderSettings, getAlphaPaths, ensureAlphaDirectories } from "./provider.ts";
import { createEventRenderer } from "./rendering/index.ts";
import { createCodingTools } from "./tools/types.ts";
import { projectSessionDir } from "./config/paths.ts";
import { exportSessionArtifact, normalizeExportFormat } from "./session-export.ts";
import { entriesFromJsonLines } from "@alpha/agent";

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
  // Ensure Alpha directories exist
  ensureAlphaDirectories();

  const parsed = parseCliArgs(args);

  // Subcommands
  if (parsed.subcommand === "sessions") {
    await handleSessions();
    return;
  }
  if (parsed.subcommand === "providers") {
    handleProviders();
    return;
  }
  if (parsed.subcommand === "export") {
    await handleExport(parsed.subArgs ?? []);
    return;
  }

  // Print mode
  if (parsed.prompt) {
    await handlePrintMode(parsed);
    return;
  }

  // Default: Start TUI
  const { runTuiApp } = await import("./tui/app.tsx");
  await runTuiApp({ resume: parsed.newSession ? false : parsed.resume });
}

// ---------------------------------------------------------------------------
// Print mode
// ---------------------------------------------------------------------------

async function handlePrintMode(args: ParsedArgs): Promise<void> {
  const cwd = args.cwd ?? process.cwd();
  const outputFormat = args.output ?? "text";
  const paths = getAlphaPaths();

  const { provider, model, providerName } = createProvider({
    providerName: args.provider,
    model: args.model,
    thinkingLevel: "medium",
    envOnly: false,
  });

  const tools = await createCodingTools(cwd);

  const sessionDir = projectSessionDir(cwd, paths);
  const sessionFileName = FsSessionStorage.sessionFileName(cwd);
  const sessionPath = `${sessionDir}/${sessionFileName}`;
  const storage = new FsSessionStorage(sessionPath);
  await storage.ensureHeader(cwd);

  const config: CodingSessionConfig = {
    provider,
    model,
    cwd,
    tools,
    storage,
    providerName,
  };

  const session = await CodingSession.load(config);
  const renderer = createEventRenderer(outputFormat);

  for await (const event of session.prompt(args.prompt!)) {
    renderer.render(event);
  }
  renderer.finish();
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function handleProviders(): void {
  const paths = getAlphaPaths();
  const settings = loadProviderSettings(paths.providersFile);

  console.log("Configured providers:\n");
  for (const provider of settings.providers) {
    const marker = provider.name === settings.defaultProvider ? "*" : " ";
    const kind = provider.kind.replace("_", "-");
    const models = provider.models.slice(0, 3).join(", ") + (provider.models.length > 3 ? "..." : "");
    const defaultModel = provider.defaultModel;

    console.log(`${marker} ${provider.name}`);
    console.log(`    kind: ${kind}`);
    console.log(`    default: ${defaultModel}`);
    console.log(`    models: ${models}`);
    // Only show apiKeyEnv for providers that have it
    if (provider.kind !== "openai_codex" && "apiKeyEnv" in provider && provider.apiKeyEnv) {
      console.log(`    env: ${provider.apiKeyEnv}`);
    }
    if (provider.credentialName) {
      console.log(`    credential: ${provider.credentialName}`);
    }
    console.log();
  }
  console.log(`Default provider: ${settings.defaultProvider}`);
  console.log(`\nConfig file: ${paths.providersFile}`);
}

async function handleExport(args: string[]): Promise<void> {
  let format: string | undefined;
  let source: string | undefined;
  let destination: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if ((arg === "--format" || arg === "-f") && i + 1 < args.length) {
      format = args[++i];
    } else if (arg.startsWith("--format=")) {
      format = arg.split("=")[1];
    } else if (arg.startsWith("--source=")) {
      source = arg.split("=")[1];
    } else if (!arg.startsWith("-")) {
      if (!destination) destination = arg;
      else source = arg;
    }
  }

  if (!destination) {
    console.log("Usage: alpha export <destination> [--source <session.jsonl>] [--format html|jsonl]");
    console.log("");
    console.log("Examples:");
    console.log("  alpha export session.html");
    console.log("  alpha export --format jsonl session.jsonl");
    console.log("  alpha export --source ~/.alpha/sessions/--myproject--/session.jsonl results.html");
    return;
  }

  try {
    const cwd = process.cwd();
    const paths = getAlphaPaths();

    let sessionPath: string;
    if (source) {
      sessionPath = source;
    } else {
      const manager = new SessionManager(paths);
      const latest = manager.latestSessionForCwd(cwd);
      if (!latest) {
        console.error("No sessions found. Run Alpha first to create one, or use --source.");
        process.exit(1);
      }
      sessionPath = latest.path;
    }

    const exportFormat = normalizeExportFormat(format);
    const outFile = destination.endsWith(`.${exportFormat}`)
      ? destination
      : `${destination}.${exportFormat}`;

    const storage = new FsSessionStorage(sessionPath);
    const entries = await storage.readAll();
    const outputPath = exportSessionArtifact(entries, outFile, { format: exportFormat });

    console.log(`Exported session to: ${outputPath}`);
  } catch (err) {
    console.error("Export failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Sessions subcommand
// ---------------------------------------------------------------------------

async function handleSessions(): Promise<void> {
  const manager = new SessionManager();
  const sessions = manager.listSessions();

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  for (const s of sessions) {
    const updatedAt = new Date(s.updatedAt * 1000).toISOString().slice(0, 16);
    console.log(`[${s.id.slice(0, 8)}] ${s.cwd} — ${s.model} (${updatedAt})`);
  }
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
