/**
 * Slash command registry for Alpha coding sessions.
 *
 * Commands are text inputs starting with `/` that perform actions
 * without sending a prompt to the model.
 */

import type { Skill } from "./resources/skills.ts";
import type { PromptTemplate } from "./resources/templates.ts";
import type { ProjectContextFile } from "./context/discovery.ts";
import type { CodingTool } from "./tools/types.ts";
import type { ThinkingLevel } from "./thinking.ts";
import type { SessionRecord } from "./session-manager.ts";
import { normalizeThinkingLevel } from "./thinking.ts";
import { normalizeExportFormat } from "./session-export.ts";

// ---------------------------------------------------------------------------
// Command Result
// ---------------------------------------------------------------------------

/**
 * Result of handling a coding-session slash command.
 */
export interface CommandResult {
  /** Whether the text was handled as a command */
  handled: boolean;
  /** Request to exit the session */
  exitRequested?: boolean;
  /** Request to clear/reset the session */
  clearRequested?: boolean;
  /** Request to start a new session */
  newSessionRequested?: boolean;
  /** Instructions for compaction (if requested) */
  compactSummary?: string;
  /** Request to export the session */
  exportRequested?: boolean;
  exportDestination?: string;
  exportFormat?: string;
  /** Request to resume a previous session */
  resumeSessionId?: string;
  resumePickerRequested?: boolean;
  /** Request to show the tree picker */
  treePickerRequested?: boolean;
  /** Login/logout requests */
  loginPickerRequested?: boolean;
  loginProvider?: string;
  logoutPickerRequested?: boolean;
  logoutProvider?: string;
  /** Model picker requests */
  modelPickerRequested?: boolean;
  scopedModelsPickerRequested?: boolean;
  /** Theme picker */
  themePickerRequested?: boolean;
  /** Thinking level change */
  thinkingLevel?: ThinkingLevel;
  /** Theme change */
  theme?: string;
  /** Message to display to the user */
  message?: string;
}

// ---------------------------------------------------------------------------
// Command Session Protocol
// ---------------------------------------------------------------------------

/**
 * Session attributes available to slash-command handlers.
 * This is a protocol/interface that the CodingSession implements.
 */
export interface CommandSession {
  readonly cwd: string;
  readonly model: string;
  readonly providerName: string;
  readonly availableModels: readonly string[];
  readonly availableProviders: readonly string[];
  readonly tools: readonly CodingTool[];
  readonly skills: readonly Skill[];
  readonly promptTemplates: readonly PromptTemplate[];
  readonly contextFiles: readonly ProjectContextFile[];
  readonly contextTokenEstimate: number;
  readonly autoCompactTokenThreshold: number | null;
  readonly contextWindowTokens: number;
  readonly thinkingLevel: ThinkingLevel;
  readonly availableThinkingLevels: readonly ThinkingLevel[];
  readonly sessionId: string | null;
  readonly sessionTitle: string | null;

  setModel(model: string): void;
  reload(): void;
  reloadProviderSettings(): void;
}

// ---------------------------------------------------------------------------
// Command Context
// ---------------------------------------------------------------------------

/**
 * Runtime context passed to slash-command handlers.
 */
export interface CommandContext {
  session: CommandSession;
  registry: CommandRegistry;
  text: string;
  name: string;
  args: string;
}

// ---------------------------------------------------------------------------
// Slash Command
// ---------------------------------------------------------------------------

/**
 * A registered slash command and its user-facing metadata.
 */
export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  handler: (context: CommandContext) => CommandResult;
  aliases?: readonly string[];
  searchTerms?: readonly string[];
}

// ---------------------------------------------------------------------------
// Command Registry
// ---------------------------------------------------------------------------

/**
 * Parse, register, list, and execute slash commands.
 */
export class CommandRegistry {
  private _commands: Map<string, SlashCommand> = new Map();
  private _aliases: Map<string, string> = new Map();

  /**
   * Register a slash command and its aliases.
   */
  register(command: SlashCommand): void {
    const name = _normalizeName(command.name);
    if (this._commands.has(name)) {
      throw new Error(`Duplicate slash command: /${name}`);
    }
    this._commands.set(name, command);

    for (const alias of command.aliases ?? []) {
      const normalizedAlias = _normalizeName(alias);
      if (this._commands.has(normalizedAlias) || this._aliases.has(normalizedAlias)) {
        throw new Error(`Duplicate slash command alias: /${normalizedAlias}`);
      }
      this._aliases.set(normalizedAlias, name);
    }
  }

  /**
   * Return a command by name or alias.
   */
  get(name: string): SlashCommand | undefined {
    const normalized = _normalizeName(name);
    const commandName = this._aliases.get(normalized) ?? normalized;
    return this._commands.get(commandName);
  }

  /**
   * Return registered commands sorted by name.
   */
  listCommands(): SlashCommand[] {
    const names = Array.from(this._commands.keys()).sort();
    return names.map((name) => this._commands.get(name)!);
  }

  /**
   * Execute a slash command, or return unhandled for ordinary prompts.
   */
  execute(session: CommandSession, text: string): CommandResult {
    const stripped = text.trim();
    if (!stripped.startsWith("/")) {
      return { handled: false };
    }

    // Skill invocations are handled separately
    if (stripped.startsWith("/skill:")) {
      return { handled: false };
    }

    const { name, args } = _parseCommand(stripped);
    if (!name) {
      return { handled: false };
    }

    // Handle "scoped models" as scoped-models
    let command = this.get(name);
    if (!command && name === "scoped" && args.toLowerCase() === "models") {
      command = this.get("scoped-models");
      if (command) {
        return command.handler({
          session,
          registry: this,
          text: stripped,
          name: "scoped-models",
          args: "",
        });
      }
    }

    if (!command) {
      return { handled: true, message: `Unknown command: /${name}` };
    }

    return command.handler({
      session,
      registry: this,
      text: stripped,
      name,
      args,
    });
  }
}

// ---------------------------------------------------------------------------
// Builtin Commands
// ---------------------------------------------------------------------------

export const BUILTIN_TUI_THEME_NAMES = ["tau-dark", "tau-light", "high-contrast"] as const;

/**
 * Create Alpha's built-in slash command registry.
 */
export function createDefaultCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();

  // /quit - Exit the session
  registry.register({
    name: "quit",
    usage: "/quit",
    description: "Exit the current session.",
    handler: _exitCommand,
    aliases: ["exit", "q"],
  });

  // /help - Show available commands
  registry.register({
    name: "help",
    usage: "/help",
    description: "Show available commands.",
    handler: _helpCommand,
    aliases: ["?"],
  });

  // /new - Start a new session
  registry.register({
    name: "new",
    usage: "/new",
    description: "Start a new session.",
    handler: _newCommand,
    searchTerms: ["clear", "reset"],
  });

  // /compact - Summarize and compact context
  registry.register({
    name: "compact",
    usage: "/compact [instructions]",
    description: "Summarize and compact active context.",
    handler: _compactCommand,
  });

  // /export - Export session
  registry.register({
    name: "export",
    usage: "/export [--format html|jsonl] [destination]",
    description: "Export the current session.",
    handler: _exportCommand,
  });

  // /session - Show session info
  registry.register({
    name: "session",
    usage: "/session",
    description: "Show session info and stats.",
    handler: _statusCommand,
    searchTerms: ["info", "status"],
  });

  // /skill - Skill help
  registry.register({
    name: "skill",
    usage: "/skill:<name> [request]",
    description: "Expand a loaded skill into your prompt.",
    handler: _skillCommand,
    searchTerms: ["skills"],
  });

  // /hotkeys - Show keyboard shortcuts
  registry.register({
    name: "hotkeys",
    usage: "/hotkeys",
    description: "Show common keyboard shortcuts.",
    handler: _hotkeysCommand,
    searchTerms: ["keys", "shortcuts", "bindings"],
  });

  // /reload - Reload resources
  registry.register({
    name: "reload",
    usage: "/reload",
    description: "Reload local resources and project context.",
    handler: _reloadCommand,
  });

  // /resume - Resume previous session
  registry.register({
    name: "resume",
    usage: "/resume [session-id]",
    description: "Resume a previous session.",
    handler: _resumeCommand,
    searchTerms: ["history", "previous"],
  });

  // /tree - Branch from previous entry
  registry.register({
    name: "tree",
    usage: "/tree",
    description: "Branch from a previous session entry.",
    handler: _treeCommand,
    searchTerms: ["branch", "history", "fork"],
  });

  // /name - Rename session
  registry.register({
    name: "name",
    usage: "/name <new name>",
    description: "Rename the current session.",
    handler: _nameCommand,
    searchTerms: ["rename", "title"],
  });

  // /model - Change model
  registry.register({
    name: "model",
    usage: "/model",
    description: "Choose the active model.",
    handler: _modelCommand,
  });

  // /scoped-models - Scoped models picker
  registry.register({
    name: "scoped-models",
    usage: "/scoped-models",
    description: "Choose models available to quick-cycle with Ctrl+P.",
    handler: _scopedModelsCommand,
    searchTerms: ["scope", "quick", "cycle"],
  });

  // /theme - Theme picker
  registry.register({
    name: "theme",
    usage: "/theme [name]",
    description: "Show or set the TUI theme.",
    handler: _themeCommand,
    searchTerms: ["light", "dark", "contrast"],
  });

  // /login - Save API key
  registry.register({
    name: "login",
    usage: "/login [provider]",
    description: "Save an API key for a built-in provider.",
    handler: _loginCommand,
  });

  // /logout - Remove credentials
  registry.register({
    name: "logout",
    usage: "/logout [provider]",
    description: "Remove saved credentials for a built-in provider.",
    handler: _logoutCommand,
  });

  // /thinking - Thinking mode control
  registry.register({
    name: "thinking",
    usage: "/thinking [level]",
    description: "Show or change thinking mode.",
    handler: _thinkingCommand,
  });

  return registry;
}

// ---------------------------------------------------------------------------
// Command Handlers
// ---------------------------------------------------------------------------

function _helpCommand(context: CommandContext): CommandResult {
  const lines = ["Available commands:", ""];
  for (const command of context.registry.listCommands()) {
    lines.push(`  ${command.usage.padEnd(35)} ${command.description}`);
  }
  lines.push("", "Use /skill:<name> [request] to expand a loaded skill into your prompt.");
  return { handled: true, message: lines.join("\n") };
}

function _exitCommand(_context: CommandContext): CommandResult {
  return { handled: true, exitRequested: true, message: "Exiting session." };
}

function _newCommand(_context: CommandContext): CommandResult {
  return { handled: true, newSessionRequested: true };
}

function _compactCommand(context: CommandContext): CommandResult {
  return {
    handled: true,
    compactSummary: context.args.trim() || undefined,
  };
}

function _exportCommand(context: CommandContext): CommandResult {
  try {
    const { format, destination } = _parseExportArgs(context.args);
    return {
      handled: true,
      exportRequested: true,
      exportDestination: destination,
      exportFormat: format,
    };
  } catch (err) {
    return { handled: true, message: String(err) };
  }
}

function _statusCommand(context: CommandContext): CommandResult {
  const session = context.session;
  const lines = [
    `Model: ${session.model}`,
    `Provider: ${session.providerName}`,
    `CWD: ${session.cwd}`,
    `Tools: ${session.tools.length}`,
    `Skills: ${session.skills.length}`,
    `Prompt templates: ${session.promptTemplates.length}`,
    `Context files: ${session.contextFiles.length}`,
    `Estimated context tokens: ${session.contextTokenEstimate}`,
    `Context window: ${session.contextWindowTokens}`,
    `Thinking mode: ${session.thinkingLevel}`,
  ];

  if (session.autoCompactTokenThreshold !== null) {
    lines.push(`Auto compact threshold: ${session.autoCompactTokenThreshold}`);
  }

  if (session.sessionId) {
    lines.push(`Session: ${session.sessionId}`);
  }

  if (session.sessionTitle) {
    lines.push(`Session name: ${session.sessionTitle}`);
  }

  return { handled: true, message: lines.join("\n") };
}

function _hotkeysCommand(_context: CommandContext): CommandResult {
  const lines = [
    "Common keyboard shortcuts:",
    "- Enter: submit prompt",
    "- Shift+Enter: insert newline",
    "- Alt+Enter: queue follow-up while running",
    "- Esc: cancel active run",
    "- Ctrl+K: open slash-command completions",
    "- Ctrl+R: open session picker",
    "- Shift+Tab: cycle thinking mode",
    "- Ctrl+T: toggle thinking tokens",
    "- Ctrl+O: collapse or expand tool output",
    "- Ctrl+C: clear prompt input",
    "- Ctrl+D: quit",
  ];
  return { handled: true, message: lines.join("\n") };
}

function _reloadCommand(context: CommandContext): CommandResult {
  try {
    context.session.reload();
    return {
      handled: true,
      message: "Reloaded local coding resources and project context.",
    };
  } catch (err) {
    return { handled: true, message: `Could not reload: ${err}` };
  }
}

function _skillCommand(context: CommandContext): CommandResult {
  const skills = context.session.skills;
  if (!skills.length) {
    return { handled: true, message: "No skills loaded." };
  }

  const lines = ["Available skills:"];
  const sortedSkills = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  for (const skill of sortedSkills) {
    lines.push(`- ${skill.name}: ${skill.description || "No description"}`);
  }
  lines.push("", "Use /skill:<name> [request] to expand a loaded skill into your prompt.");
  return { handled: true, message: lines.join("\n") };
}

function _resumeCommand(context: CommandContext): CommandResult {
  if (!context.args) {
    return { handled: true, resumePickerRequested: true };
  }

  const sessionId = context.args.trim();
  return {
    handled: true,
    resumeSessionId: sessionId,
  };
}

function _treeCommand(context: CommandContext): CommandResult {
  if (context.args) {
    return { handled: true, message: "Usage: /tree" };
  }
  return { handled: true, treePickerRequested: true };
}

function _nameCommand(context: CommandContext): CommandResult {
  if (!context.args) {
    const title = context.session.sessionTitle || "Untitled session";
    return {
      handled: true,
      message: `Current session name: ${title}\nUsage: /name <new name>`,
    };
  }

  const name = context.args.trim();
  if (!name) {
    return { handled: true, message: "Usage: /name <new name>" };
  }

  // The actual renaming is handled by the session
  return {
    handled: true,
    message: `Session renamed to: ${name}`,
  };
}

function _modelCommand(context: CommandContext): CommandResult {
  if (context.args) {
    const model = context.args.trim();
    const availableModels = new Set(context.session.availableModels);

    if (availableModels.size > 0 && !availableModels.has(model)) {
      const models = Array.from(availableModels).sort().join(", ");
      return {
        handled: true,
        message: `Unknown model for provider ${context.session.providerName}: ${model}\nAvailable models: ${models}`,
      };
    }

    context.session.setModel(model);
    return { handled: true, message: `Current model: ${model}` };
  }

  return { handled: true, modelPickerRequested: true };
}

function _scopedModelsCommand(context: CommandContext): CommandResult {
  if (context.args) {
    return { handled: true, message: "Usage: /scoped-models" };
  }
  return { handled: true, scopedModelsPickerRequested: true };
}

function _thinkingCommand(context: CommandContext): CommandResult {
  const session = context.session;
  const available = session.availableThinkingLevels;

  if (!context.args) {
    const lines = [`Thinking mode: ${session.thinkingLevel}`];
    if (available.length > 0) {
      lines.push(`Available modes: ${available.join(", ")}`);
    } else {
      lines.push(`Thinking controls unavailable for ${session.providerName}:${session.model}`);
    }
    return { handled: true, message: lines.join("\n") };
  }

  if (!available.length) {
    return {
      handled: true,
      message: `Thinking controls are unavailable for ${session.providerName}:${session.model}`,
    };
  }

  try {
    const level = normalizeThinkingLevel(context.args);
    if (!available.includes(level)) {
      return {
        handled: true,
        message: `Thinking mode ${level} is not available for ${session.providerName}:${session.model}\nAvailable modes: ${available.join(", ")}`,
      };
    }
    return { handled: true, thinkingLevel: level };
  } catch (err) {
    return { handled: true, message: String(err) };
  }
}

function _themeCommand(context: CommandContext): CommandResult {
  if (!context.args) {
    return { handled: true, themePickerRequested: true };
  }

  const themeName = context.args.trim();
  if (!BUILTIN_TUI_THEME_NAMES.includes(themeName as typeof BUILTIN_TUI_THEME_NAMES[number])) {
    return {
      handled: true,
      message: `Unknown theme: ${themeName}\nAvailable themes: ${BUILTIN_TUI_THEME_NAMES.join(", ")}`,
    };
  }

  return { handled: true, theme: themeName };
}

function _loginCommand(context: CommandContext): CommandResult {
  const providerName = context.args.trim();

  if (providerName) {
    // Validate provider exists
    const providers = context.session.availableProviders;
    if (!providers.includes(providerName)) {
      return {
        handled: true,
        message: `Unknown login provider: ${providerName}\nAvailable providers: ${providers.join(", ")}`,
      };
    }
    return { handled: true, loginProvider: providerName };
  }

  return { handled: true, loginPickerRequested: true };
}

function _logoutCommand(context: CommandContext): CommandResult {
  const providerName = context.args.trim();

  if (providerName) {
    const providers = context.session.availableProviders;
    if (!providers.includes(providerName)) {
      return {
        handled: true,
        message: `Unknown logout provider: ${providerName}\nAvailable providers: ${providers.join(", ")}`,
      };
    }
    return { handled: true, logoutProvider: providerName };
  }

  return { handled: true, logoutPickerRequested: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _normalizeName(name: string): string {
  return name.trim().replace(/^\//, "").toLowerCase();
}

function _parseCommand(text: string): { name: string; args: string } {
  const withoutSlash = text.slice(1);
  const spaceIndex = withoutSlash.indexOf(" ");

  if (spaceIndex === -1) {
    return { name: _normalizeName(withoutSlash), args: "" };
  }

  const name = _normalizeName(withoutSlash.slice(0, spaceIndex));
  const args = withoutSlash.slice(spaceIndex + 1).trim();
  return { name, args };
}

function _parseExportArgs(args: string): { format?: string; destination?: string } {
  const parts = args.split(/\s+/).filter(Boolean);
  let format: string | undefined;
  let destination: string | undefined;

  let i = 0;
  while (i < parts.length) {
    const part = parts[i]!;

    if (part === "--format") {
      i++;
      if (i >= parts.length) {
        throw new Error("Usage: /export [--format html|jsonl] [destination]");
      }
      format = parts[i];
    } else if (part.startsWith("--format=")) {
      format = part.split("=")[1];
    } else if (part.startsWith("-")) {
      throw new Error(`Unknown export option: ${part}`);
    } else if (destination === undefined) {
      destination = part;
    } else {
      throw new Error("Usage: /export [--format html|jsonl] [destination]");
    }

    i++;
  }

  // Validate format if provided
  if (format) {
    try {
      normalizeExportFormat(format);
    } catch {
      throw new Error(`Invalid export format: ${format}. Use 'html' or 'jsonl'.`);
    }
  }

  return { format, destination };
}
