import type { ModelProvider } from "@alpha/ai";
import {
  AgentHarness,
  type AgentEvent,
  type AgentMessage,
  type SessionEntry,
  type SessionState,
  type SessionStorage,
  fromEntries,
  activeLeafId,
  newEntryId,
  currentTimestamp,
  InMemorySessionStorage,
  pathToEntry,
  branchableEntries,
} from "@alpha/agent";
import type { CodingTool } from "./tools/types.ts";
import { createCodingTools } from "./tools/types.ts";
import type { Skill } from "./resources/skills.ts";
import { loadSkills } from "./resources/skills.ts";
import type { PromptTemplate } from "./resources/templates.ts";
import { expandTemplateInvocation } from "./resources/templates.ts";
import type { ProjectContextFile } from "./context/discovery.ts";
import { discoverProjectContext } from "./context/discovery.ts";
import { type ContextUsageEstimate, estimateContextTokens } from "./context/tokens.ts";
import {
  recentPreservingCompactionPlan,
  summarizeMessagesForCompaction,
} from "./context/compaction.ts";
import { buildSystemPrompt } from "./prompt/system.ts";
import type { ThinkingLevel } from "./thinking.ts";
import { normalizeThinkingLevel, providerThinkingLevels } from "./thinking.ts";
import { expandSkillInvocation } from "./resources/skills.ts";
import { exportSessionArtifact, normalizeExportFormat } from "./session-export.ts";
import {
  CommandRegistry,
  createDefaultCommandRegistry,
  type CommandResult,
  type CommandSession,
} from "./commands.ts";

// ---------------------------------------------------------------------------
// CodingSessionConfig
// ---------------------------------------------------------------------------

export interface CodingSessionConfig {
  provider: ModelProvider;
  model: string;
  cwd: string;
  system?: string;
  storage?: SessionStorage;
  sessionId?: string;
  thinkingLevel?: ThinkingLevel;
  providerName?: string;
  autoCompactTokenThreshold?: number;
  tools?: CodingTool[];
  skills?: Skill[];
  promptTemplates?: PromptTemplate[];
  contextFiles?: ProjectContextFile[];
  customSystemPrompt?: string;
  appendSystemPrompt?: string;
  maxTurns?: number;
  /** Available models for the current provider */
  availableModels?: readonly string[];
  /** Available provider names */
  availableProviders?: readonly string[];
  /** Context window for the model */
  contextWindowTokens?: number;
}

export interface BranchChoice {
  entryId: string;
  parentId: string | null;
  summary: string;
  indent: number;
}

// ---------------------------------------------------------------------------
// CodingSession
// ---------------------------------------------------------------------------

/**
 * CodingSession is the central orchestrator for Alpha.
 * It implements CommandSession for slash command support.
 */
export class CodingSession implements CommandSession {
  private _config: CodingSessionConfig;
  private _harness: AgentHarness;
  private _storage: SessionStorage;
  private _tools: CodingTool[];
  private _skills: Skill[];
  private _promptTemplates: PromptTemplate[];
  private _contextFiles: ProjectContextFile[];
  private _systemPrompt: string;
  private _model: string;
  private _thinkingLevel: ThinkingLevel;
  private _providerName: string;
  private _sessionId: string;
  private _allEntries: SessionEntry[] = [];
  private _commandRegistry: CommandRegistry;
  private _sessionTitle: string | null = null;

  constructor(config: CodingSessionConfig) {
    const cwd = config.cwd;

    this._config = config;
    this._storage = config.storage ?? new InMemorySessionStorage();
    this._model = config.model;
    this._thinkingLevel = config.thinkingLevel ?? "medium";
    this._providerName = config.providerName ?? "default";
    this._sessionId = config.sessionId ?? newEntryId();

    this._tools = config.tools ?? [];
    this._skills = config.skills ?? [];
    this._promptTemplates = config.promptTemplates ?? [];
    this._contextFiles = config.contextFiles ?? [];

    this._systemPrompt = config.system ?? buildSystemPrompt({
      cwd,
      tools: this._tools,
      skills: this._skills,
      customPrompt: config.customSystemPrompt,
      appendPrompt: config.appendSystemPrompt,
      contextFiles: this._contextFiles,
    });

    this._harness = new AgentHarness({
      provider: config.provider,
      model: config.model,
      system: this._systemPrompt,
      tools: this._tools,
      maxTurns: config.maxTurns,
    });

    this._commandRegistry = createDefaultCommandRegistry();

    // Wire persistence
    this._harness.subscribe((ev: AgentEvent) => {
      if (ev.type === "message_end") {
        this._persistMessage(ev.message);
      }
    });
  }

  // -- Factory ----------------------------------------------------------------

  static async load(config: CodingSessionConfig): Promise<CodingSession> {
    const storage = config.storage ?? new InMemorySessionStorage();
    const entries = await storage.readAll();

    const session = new CodingSession({ ...config, storage });
    session._allEntries = entries;

    if (entries.length === 0) {
      // Create initial entries
      const info: SessionEntry = {
        type: "session_info", id: newEntryId(), parentId: null,
        timestamp: currentTimestamp(), cwd: config.cwd, createdAt: new Date().toISOString(),
      };
      const modelChange: SessionEntry = {
        type: "model_change", id: newEntryId(), parentId: info.id,
        timestamp: currentTimestamp(), model: config.model, providerName: config.providerName,
      };
      const thinkingChange: SessionEntry = {
        type: "thinking_level_change", id: newEntryId(), parentId: modelChange.id,
        timestamp: currentTimestamp(), level: config.thinkingLevel ?? "medium",
      };
      await storage.append(info);
      await storage.append(modelChange);
      await storage.append(thinkingChange);
      session._allEntries = await storage.readAll();
    }

    // Replay state from entries
    const leafId = activeLeafId(session._allEntries);
    const state = fromEntries(session._allEntries, leafId);
    session._harness.replaceMessages([...state.messages]);

    return session;
  }

  // -- Core API ---------------------------------------------------------------

  get cwd(): string { return this._config.cwd; }
  get model(): string { return this._model; }
  get providerName(): string { return this._providerName; }
  get tools(): CodingTool[] { return this._tools; }
  get messages(): readonly AgentMessage[] { return this._harness.messages; }
  get thinkingLevel(): ThinkingLevel { return this._thinkingLevel; }
  get isRunning(): boolean { return this._harness.isRunning; }
  get sessionId(): string { return this._sessionId; }
  get sessionTitle(): string | null { return this._sessionTitle; }

  // -- CommandSession interface ------------------------------------------------

  get availableModels(): readonly string[] {
    return this._config.availableModels ?? [];
  }

  get availableProviders(): readonly string[] {
    return this._config.availableProviders ?? [];
  }

  get contextWindowTokens(): number {
    return this._config.contextWindowTokens ?? 128000;
  }

  get autoCompactTokenThreshold(): number | null {
    return this._config.autoCompactTokenThreshold ?? null;
  }

  get availableThinkingLevels(): readonly ThinkingLevel[] {
    return ["off", "minimal", "low", "medium", "high", "xhigh"];
  }

  get promptTemplates(): readonly PromptTemplate[] {
    return this._promptTemplates;
  }

  get contextFiles(): readonly ProjectContextFile[] {
    return this._contextFiles;
  }

  get skills(): readonly Skill[] {
    return this._skills;
  }

  cancel(): void { this._harness.cancel(); }

  get contextTokenEstimate(): number {
    const estimate = estimateContextTokens(this._systemPrompt, [...this._harness.messages], this._tools);
    return estimate.totalTokens;
  }

  reloadProviderSettings(): void {
    // No-op by default - can be overridden
  }

  // -- Prompt -----------------------------------------------------------------

  async *prompt(content: string): AsyncIterable<AgentEvent> {
    const text = this.expandPromptText(content);

    if (this._harness.isRunning) {
      this._harness.steer(text);
      return;
    }

    const threshold = this._config.autoCompactTokenThreshold;
    if (threshold != null) {
      const usage = this.contextTokenEstimate;
      if (usage > threshold) {
        await this._compactImpl();
      }
    }

    yield* this._harness.prompt(text);
  }

  async *continue_(): AsyncIterable<AgentEvent> {
    yield* this._harness.continue_();
  }

  // -- Model/Provider management -----------------------------------------------

  setModel(model: string): void {
    this._model = model;
    this._harness.setModel(model);
    // Persist asynchronously
    this._appendEntry({
      type: "model_change", id: newEntryId(), parentId: this._lastParentId(),
      timestamp: currentTimestamp(), model,
    }).catch(() => {});
  }

  async setProvider(providerName: string): Promise<void> {
    this._providerName = providerName;
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    this._thinkingLevel = normalizeThinkingLevel(level);
    await this._appendEntry({
      type: "thinking_level_change", id: newEntryId(), parentId: this._lastParentId(),
      timestamp: currentTimestamp(), level: this._thinkingLevel,
    });
  }

  // -- Session operations ------------------------------------------------------

  async compact(_instructions?: string): Promise<void> {
    await this._compactImpl();
  }

  async reload(): Promise<void> {
    this._skills = loadSkills([]);
    this._contextFiles = discoverProjectContext(this._config.cwd);
  }

  async resume(_sessionId: string): Promise<void> {}

  async newSession(): Promise<void> {
    this._sessionId = newEntryId();
    this._allEntries = [];
    this._harness.replaceMessages([]);
  }

  /** Export the session to HTML or JSONL format. */
  async export(destination?: string, format?: string): Promise<string> {
    const entries = this._allEntries;
    const outputPath = destination ?? `session-export.${format ?? "html"}`;
    return exportSessionArtifact(entries, outputPath, {
      title: this._sessionId,
      source: this.cwd,
      format,
    });
  }

  // -- Commands ---------------------------------------------------------------

  /**
   * Handle a slash command text. Returns the result for the TUI to process.
   */
  handleCommand(text: string): CommandResult {
    return this._commandRegistry.execute(this, text);
  }

  /**
   * Apply a command result to the session. Call after handling a command result.
   */
  async applyCommandResult(result: CommandResult): Promise<string | undefined> {
    if (result.exitRequested) {
      return result.message;
    }

    if (result.newSessionRequested) {
      await this.newSession();
      return "Started new session.";
    }

    if (result.compactSummary !== undefined) {
      await this.compact(result.compactSummary);
      return "Compaction complete.";
    }

    if (result.exportRequested) {
      const path = await this.export(result.exportDestination, result.exportFormat);
      return `Exported to: ${path}`;
    }

    if (result.thinkingLevel) {
      await this.setThinkingLevel(result.thinkingLevel);
      return `Thinking level: ${result.thinkingLevel}`;
    }

    if (result.message) {
      return result.message;
    }

    return undefined;
  }

  /**
   * Get the command registry for autocompletion.
   */
  get commandRegistry(): CommandRegistry {
    return this._commandRegistry;
  }

  async runTerminalCommand(_command: string, _addToContext: boolean): Promise<void> {}

  // -- Prompt expansion -------------------------------------------------------

  expandPromptText(text: string): string {
    const skillResult = expandSkillInvocation(text, this._skills);
    if (skillResult) return skillResult;

    const tmplResult = expandTemplateInvocation(text, this._promptTemplates);
    if (tmplResult) return tmplResult;

    return text;
  }

  // -- Tree branching ----------------------------------------------------------

  treeChoices(): BranchChoice[] {
    const messages = branchableEntries(this._allEntries);
    return messages.map((e, i) => ({
      entryId: e.id,
      parentId: e.parentId,
      summary: e.type === "message" ? this._summarizeMessage(e.message) : e.id,
      indent: 0,
    }));
  }

  async branchTo(entryId: string, _summarize?: boolean, _customInstructions?: string): Promise<void> {
    // Create a leaf entry pointing to the target
    const leaf: SessionEntry = {
      type: "leaf", id: newEntryId(), parentId: this._lastParentId(),
      timestamp: currentTimestamp(), entryId,
    };
    await this._appendEntry(leaf);

    // Reload state from the new branch
    await this._refreshFromStorage();
  }

  // -- Persistence (public for Storage verification) ---------------------------

  get storage(): SessionStorage { return this._storage; }
  get allEntries(): SessionEntry[] { return this._allEntries; }

  // -- Private helpers --------------------------------------------------------

  private _persistMessage(message: AgentMessage): void {
    const entryId = newEntryId();
    const parentId = this._lastParentId();

    const msgEntry: SessionEntry = {
      type: "message", id: entryId, parentId,
      timestamp: currentTimestamp(), message,
    };
    const leafEntry: SessionEntry = {
      type: "leaf", id: newEntryId(), parentId: entryId,
      timestamp: currentTimestamp(), entryId,
    };

    // Append to storage and local cache
    this._storage.append(msgEntry).catch(() => {});
    this._storage.append(leafEntry).catch(() => {});
    this._allEntries.push(msgEntry);
    this._allEntries.push(leafEntry);
  }

  private async _appendEntry(entry: SessionEntry): Promise<void> {
    await this._storage.append(entry);
    this._allEntries.push(entry);
  }

  private async _refreshFromStorage(): Promise<void> {
    this._allEntries = await this._storage.readAll();
    const leafId = activeLeafId(this._allEntries);
    const state = fromEntries(this._allEntries, leafId);
    this._harness.replaceMessages([...state.messages]);
  }

  private _lastParentId(): string | null {
    for (let i = this._allEntries.length - 1; i >= 0; i--) {
      const e = this._allEntries[i]!;
      if (e.type === "leaf") return e.id;
    }
    return null;
  }

  private _summarizeMessage(message: AgentMessage): string {
    const prefix = `[${message.role[0]!.toUpperCase() + message.role.slice(1)}]`;
    const content = message.content.slice(0, 60);
    return `${prefix}: ${content}`;
  }

  private async _compactImpl(): Promise<void> {
    const msgs = this._harness.messages;
    const plan = recentPreservingCompactionPlan([...msgs]);

    if (plan.compact.length === 0) return;

    const summary = summarizeMessagesForCompaction(plan.compact);
    this._harness.replaceMessages([
      { role: "user", content: `Previous conversation summary:\n${summary}` },
      ...plan.keep,
    ]);
  }
}
