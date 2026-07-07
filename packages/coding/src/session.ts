/**
 * CodingSession — the core session manager for Alpha.
 *
 * Wraps AgentHarness with:
 * - Durable session storage (JSONL)
 * - Default coding tools (read, write, edit, bash)
 * - Slash command handling
 * - Model/provider management
 * - Thinking level support
 * - Context compaction
 * - Session tree navigation
 *
 * Matches Tau's CodingSession architecture.
 */

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
import { discoverProjectContext, type ResourceDiagnostic } from "./context/discovery.ts";
import { type ContextUsageEstimate, estimateContextTokens } from "./context/tokens.ts";
import {
  recentPreservingCompactionPlan,
  summarizeMessagesForCompaction,
  buildCompactionPrompt,
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
// Types matching Tau's session.py
// ---------------------------------------------------------------------------

/** A selectable model and the provider that serves it. */
export interface ModelChoice {
  providerName: string;
  model: string;
}

/** One branchable entry in the active session tree. */
export interface SessionTreeChoice {
  entryId: string;
  label: string;
  active: boolean;
  isToolCall: boolean;
}

/** Result of moving the active session tree leaf. */
export interface SessionTreeBranchResult {
  message: string;
  inputPrefill?: string | null;
}

/** Result of an input-bar terminal command. */
export interface TerminalCommandResult {
  command: string;
  output: string;
  exitCode: number | null;
  ok: boolean;
  addedToContext: boolean;
}

/** Parsed input-bar terminal command request. */
export interface TerminalCommandRequest {
  command: string;
  add_to_context: boolean;
}

/** Tau-owned resources loaded around a coding session. */
export interface SessionResources {
  skills: readonly Skill[];
  promptTemplates: readonly PromptTemplate[];
  contextFiles: readonly ProjectContextFile[];
  diagnostics: readonly ResourceDiagnostic[];
}

/** Prepared active-context entries for a compaction run. */
export interface CompactionPlan {
  replaceEntryIds: string[];
  messagesToSummarize: AgentMessage[];
}

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
  providerSettings?: ProviderSettings;
  autoCompactTokenThreshold?: number;
  autoCompactEnabled?: boolean;
  contextWindowTokens?: number;
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
  /** Resource paths for loading skills/templates */
  resourcePaths?: ResourcePaths;
  /** Session manager for indexed sessions */
  sessionManager?: SessionManager | null;
}

// ---------------------------------------------------------------------------
// Resource paths (simplified from Tau's TauResourcePaths)
// ---------------------------------------------------------------------------

export interface ResourcePaths {
  skillsDir?: string;
  templatesDir?: string;
  contextFiles?: string[];
}

// ---------------------------------------------------------------------------
// Provider settings (simplified)
// ---------------------------------------------------------------------------

export interface ProviderSettings {
  defaultProvider: string;
  providers: ProviderConfig[];
  scopedModels: ScopedModelConfig[];
}

export interface ProviderConfig {
  name: string;
  models: string[];
  defaultModel: string;
  thinkingLevels?: ThinkingLevel[];
  thinkingModels?: string[];
}

export interface ScopedModelConfig {
  provider: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Session manager (simplified)
// ---------------------------------------------------------------------------

export interface SessionManager {
  getSession(id: string): SessionRecord | undefined;
  createSession(cwd: string, model: string, providerName?: string): SessionRecord;
  touchSession(id: string, opts?: { model?: string; providerName?: string; title?: string }): SessionRecord | null | undefined;
  listSessions(cwd?: string): SessionRecord[];
  latestSessionForCwd?(cwd: string): SessionRecord | undefined;
}

export interface SessionRecord {
  id: string;
  cwd: string;
  model?: string;
  providerName?: string;
  title?: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  name?: string;
  messageCount?: number;
}

// ---------------------------------------------------------------------------
// BranchChoice (legacy compatibility)
// ---------------------------------------------------------------------------

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
  private _lastParentId: string | null = null;
  private _resourceDiagnostics: ResourceDiagnostic[] = [];

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

    // Load resources
    const resources = await _loadSessionResources(config.resourcePaths, config.contextFiles);

    const session = new CodingSession({
      ...config,
      storage,
      skills: config.skills ?? [...resources.skills],
      promptTemplates: config.promptTemplates ?? [...resources.promptTemplates],
      contextFiles: config.contextFiles ?? [...resources.contextFiles],
    });

    session._allEntries = entries;
    session._resourceDiagnostics = [...resources.diagnostics];

    if (entries.length === 0) {
      // Create initial entries matching Tau
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

      const initialEntries = [info, modelChange, thinkingChange];
      for (const entry of initialEntries) {
        await storage.append(entry);
      }
      session._allEntries = await storage.readAll();
      session._lastParentId = thinkingChange.id;
    } else {
      // Find last parent
      session._lastParentId = _lastParentIdFromEntries(session._allEntries);
    }

    // Replay state from entries
    const leafId = activeLeafId(session._allEntries);
    const state = fromEntries(session._allEntries, leafId);
    session._harness.replaceMessages([...state.messages]);

    // Sync thinking level
    session._syncThinkingLevelToActiveModel();

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

  get resourceDiagnostics(): readonly ResourceDiagnostic[] {
    return this._resourceDiagnostics;
  }

  /** Structured context accounting for the active provider context. */
  get contextUsage(): ContextUsageEstimate {
    return estimateContextTokens(this._systemPrompt, [...this._harness.messages], this._tools);
  }

  cancel(): void { this._harness.cancel(); }

  get contextTokenEstimate(): number {
    return this.contextUsage.totalTokens;
  }

  reloadProviderSettings(): void {
    // No-op by default - can be overridden
  }

  // -- Prompt -----------------------------------------------------------------

  async *prompt(content: string, streamingBehavior?: "steer" | "follow_up"): AsyncIterable<AgentEvent> {
    const text = this.expandPromptText(content);

    if (this._harness.isRunning) {
      if (streamingBehavior === "steer") {
        this._harness.steer(text);
        return;
      }
      if (streamingBehavior === "follow_up") {
        this._harness.followUp(text);
        return;
      }
      throw new Error("CodingSession is already running; pass streamingBehavior to queue a message.");
    }

    // Auto-compact if needed
    await this._tryAutoCompact();

    yield* this._harness.prompt(text);

    // Post-prompt auto-compact
    await this._tryAutoCompact();
  }

  async *continue_(): AsyncIterable<AgentEvent> {
    yield* this._harness.continue_();
  }

  // -- Model/Provider management -----------------------------------------------

  setModel(model: string): void {
    this._model = model;
    this._harness.setModel(model);
    this._syncThinkingLevelToActiveModel();
    // Persist asynchronously
    this._appendEntry({
      type: "model_change", id: newEntryId(), parentId: this._lastParentId,
      timestamp: currentTimestamp(), model,
    }).catch(() => {});
  }

  async setProvider(providerName: string): Promise<void> {
    this._providerName = providerName;
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    this._thinkingLevel = normalizeThinkingLevel(level);
    await this._appendEntry({
      type: "thinking_level_change", id: newEntryId(), parentId: this._lastParentId,
      timestamp: currentTimestamp(), level: this._thinkingLevel,
    });
  }

  cycleThinkingLevel(): ThinkingLevel {
    const available = this.availableThinkingLevels;
    if (available.length === 0) return this._thinkingLevel;

    const currentIndex = available.indexOf(this._thinkingLevel);
    const nextIndex = (currentIndex + 1) % available.length;
    this._thinkingLevel = available[nextIndex]!;
    return this._thinkingLevel;
  }

  // -- Session operations ------------------------------------------------------

  async compact(instructions?: string): Promise<string> {
    const plan = this._manualCompactionPlan();
    const summary = await this._generateCompactionSummary(plan.messagesToSummarize, instructions);

    // Replace messages in harness
    this._harness.replaceMessages([
      { role: "user", content: `Previous conversation summary:\n${summary}` },
      ...this._keepRecentMessages(),
    ]);

    return `Compacted ${plan.replaceEntryIds.length} context entries.`;
  }

  async reload(): Promise<void> {
    const resources = await _loadSessionResources(this._config.resourcePaths, this._config.contextFiles);
    this._skills = [...resources.skills];
    this._contextFiles = [...resources.contextFiles];
    this._promptTemplates = [...resources.promptTemplates];
    this._resourceDiagnostics = [...resources.diagnostics];

    // Rebuild system prompt if skills/context changed
    this._systemPrompt = buildSystemPrompt({
      cwd: this._config.cwd,
      tools: this._tools,
      skills: this._skills,
      customPrompt: this._config.customSystemPrompt,
      appendPrompt: this._config.appendSystemPrompt,
      contextFiles: this._contextFiles,
    });
  }

  async resume(sessionId: string): Promise<string> {
    const manager = this._config.sessionManager;
    if (!manager) {
      throw new Error("Session manager is not available");
    }

    const record = manager.getSession(sessionId);
    if (!record) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    // Would need to reload full session from record.path
    // For now, just update session ID
    this._sessionId = sessionId;
    return `Resumed session: ${sessionId}`;
  }

  async newSession(): Promise<string> {
    const manager = this._config.sessionManager;
    if (!manager) {
      this._sessionId = newEntryId();
      this._allEntries = [];
      this._harness.replaceMessages([]);
      return "Started new session.";
    }

    const record = manager.createSession(this.cwd, this.model, this.providerName);
    this._sessionId = record.id;
    this._allEntries = [];
    this._harness.replaceMessages([]);
    return `Started new session: ${record.id}`;
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

  async runTerminalCommand(command: string, addToContext: boolean): Promise<TerminalCommandResult> {
    const bashTool = this._tools.find(t => t.name === "bash");
    if (!bashTool) {
      throw new Error("Bash tool not available");
    }

    const result = await bashTool.execute({ command }, undefined);
    const exitCode = result.data && typeof result.data === "object" && "exit_code" in result.data
      ? result.data.exit_code as number | null
      : null;

    if (addToContext) {
      this._harness.appendMessage({
        role: "user",
        content: `[Terminal command: ${command}]\n${result.content}`,
      });
      await this._persistMessage(this._harness.messages[this._harness.messages.length - 1]!);
    }

    return {
      command,
      output: result.content,
      exitCode,
      ok: result.ok,
      addedToContext: addToContext,
    };
  }

  // -- Prompt expansion -------------------------------------------------------

  expandPromptText(text: string): string {
    const skillResult = expandSkillInvocation(text, this._skills);
    if (skillResult) return skillResult;

    const tmplResult = expandTemplateInvocation(text, this._promptTemplates);
    if (tmplResult) return tmplResult;

    return text;
  }

  // -- Tree branching ----------------------------------------------------------

  async treeChoices(): Promise<SessionTreeChoice[]> {
    const messages = branchableEntries(this._allEntries);
    return messages.map((e) => ({
      entryId: e.id,
      label: e.type === "message" ? this._summarizeMessage(e.message) : e.id,
      active: e.id === activeLeafId(this._allEntries),
      isToolCall: e.type === "message" && "tool_calls" in e.message && (e.message as any).tool_calls?.length > 0,
    }));
  }

  async branchTo(entryId: string, summarize?: boolean, customInstructions?: string): Promise<SessionTreeBranchResult> {
    // Create a leaf entry pointing to the target
    const leaf: SessionEntry = {
      type: "leaf", id: newEntryId(), parentId: this._lastParentId,
      timestamp: currentTimestamp(), entryId,
    };
    await this._appendEntry(leaf);

    // Reload state from the new branch
    await this._refreshFromStorage();

    return { message: `Branched session at ${entryId}.` };
  }

  // -- Queue management --------------------------------------------------------

  get queuedMessages(): { steering: readonly AgentMessage[]; followUp: readonly AgentMessage[] } {
    // Would need to expose from harness
    return { steering: [], followUp: [] };
  }

  get queuedSteeringMessages(): readonly string[] {
    // Would need to expose from harness
    return [];
  }

  get queuedFollowUpMessages(): readonly string[] {
    // Would need to expose from harness
    return [];
  }

  clearQueuedMessages(): void {
    // Would need to expose from harness
  }

  popLatestFollowUpMessage(): string | null {
    // Would need to expose from harness
    return null;
  }

  // -- Persistence (public for Storage verification) ---------------------------

  get storage(): SessionStorage { return this._storage; }
  get allEntries(): SessionEntry[] { return this._allEntries; }

  // -- Private helpers --------------------------------------------------------

  private _syncThinkingLevelToActiveModel(): void {
    const available = this.availableThinkingLevels;
    if (available.length > 0 && !available.includes(this._thinkingLevel)) {
      this._thinkingLevel = available[0]!;
    }
  }

  private _persistMessage(message: AgentMessage): void {
    const entryId = newEntryId();
    const parentId = this._lastParentId;

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
    this._lastParentId = leafEntry.id;
  }

  private async _appendEntry(entry: SessionEntry): Promise<void> {
    await this._storage.append(entry);
    this._allEntries.push(entry);
    this._lastParentId = entry.id;
  }

  private async _refreshFromStorage(): Promise<void> {
    this._allEntries = await this._storage.readAll();
    const leafId = activeLeafId(this._allEntries);
    const state = fromEntries(this._allEntries, leafId);
    this._harness.replaceMessages([...state.messages]);
    this._lastParentId = _lastParentIdFromEntries(this._allEntries);
  }

  private _summarizeMessage(message: AgentMessage): string {
    const prefix = `[${message.role[0]!.toUpperCase() + message.role.slice(1)}]`;
    const content = typeof message.content === "string"
      ? message.content.slice(0, 60)
      : "[complex content]";
    return `${prefix}: ${content}`;
  }

  private _manualCompactionPlan(): CompactionPlan {
    const msgs = this._harness.messages;
    const plan = recentPreservingCompactionPlan([...msgs]);

    return {
      replaceEntryIds: [], // Would need proper entry ID tracking
      messagesToSummarize: plan.compact,
    };
  }

  private _keepRecentMessages(): AgentMessage[] {
    const msgs = this._harness.messages;
    const plan = recentPreservingCompactionPlan([...msgs]);
    return [...plan.keep];
  }

  private async _generateCompactionSummary(messages: AgentMessage[], instructions?: string): Promise<string> {
    try {
      const prompt = buildCompactionPrompt(messages, instructions);
      const system = "You are a conversation summarizer. Summarize the conversation accurately and concisely following the requested format.";

      const response = this._config.provider.streamResponse({
        model: this._model,
        system,
        messages: [{ role: "user", content: prompt }],
        tools: [],
      });

      let summary = "";
      for await (const event of response) {
        if (event.type === "text_delta") {
          summary += event.text;
        }
        if (event.type === "error") {
          break;
        }
      }

      if (summary.trim()) {
        return summary;
      }
    } catch {
      // Fall through to deterministic fallback
    }

    return summarizeMessagesForCompaction(messages, instructions);
  }

  private async _tryAutoCompact(): Promise<boolean> {
    const threshold = this.autoCompactTokenThreshold;
    if (threshold === null) return false;

    const usage = this.contextTokenEstimate;
    if (usage <= threshold) return false;

    await this.compact();
    return true;
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

async function _loadSessionResources(
  resourcePaths?: ResourcePaths,
  contextFiles?: ProjectContextFile[],
): Promise<SessionResources> {
  const skills = loadSkills(resourcePaths?.skillsDir ? [resourcePaths.skillsDir] : []);
  const promptTemplates: PromptTemplate[] = []; // Would load from templatesDir
  const context = contextFiles ?? discoverProjectContext(process.cwd());
  const diagnostics: ResourceDiagnostic[] = []; // Would collect from loading

  return {
    skills,
    promptTemplates,
    contextFiles: context,
    diagnostics,
  };
}

function _lastParentIdFromEntries(entries: SessionEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.type === "leaf") return e.id;
  }
  return null;
}
