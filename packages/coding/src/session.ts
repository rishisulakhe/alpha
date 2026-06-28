import type { ModelProvider } from "@alpha/ai";
import {
  AgentHarness,
  type AgentHarnessConfig,
  type AgentEvent,
  type AgentMessage,
  type SessionEntry,
  type SessionState,
  type SessionStorage,
  type SessionInfoEntry,
  type ModelChangeEntry,
  type ThinkingLevelChangeEntry,
  type MessageEntry,
  type LeafEntry,
  type CompactionEntry,
  type BranchSummaryEntry,
  type LabelEntry,
  type CustomEntry,
  fromEntries,
  activeLeafId,
  newEntryId,
  currentTimestamp,
  InMemorySessionStorage,
} from "@alpha/agent";
import type { CodingTool } from "./tools/types.ts";
import { createCodingTools } from "./tools/types.ts";
import type { Skill } from "./resources/skills.ts";
import { loadSkills } from "./resources/skills.ts";
import type { PromptTemplate } from "./resources/templates.ts";
import { loadPromptTemplates, expandTemplateInvocation } from "./resources/templates.ts";
import type { ProjectContextFile } from "./context/discovery.ts";
import { discoverProjectContext } from "./context/discovery.ts";
import { type ContextUsageEstimate, estimateContextTokens, autoCompactionThreshold, DEFAULT_CONTEXT_WINDOW } from "./context/tokens.ts";
import {
  buildCompactionPrompt,
  recentPreservingCompactionPlan,
  summarizeMessagesForCompaction,
} from "./context/compaction.ts";
import { buildSystemPrompt } from "./prompt/system.ts";
import type { ThinkingLevel } from "./thinking.ts";
import { normalizeThinkingLevel } from "./thinking.ts";
import { expandSkillInvocation } from "./resources/skills.ts";

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
}

// ---------------------------------------------------------------------------
// CodingSession
// ---------------------------------------------------------------------------

export class CodingSession {
  private _config: CodingSessionConfig;
  private _state: SessionState;
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
  private _persistedCount = 0;
  private _nextParentId: string | null = null;

  constructor(config: CodingSessionConfig, state: SessionState) {
    const cwd = config.cwd;

    this._config = config;
    this._state = state;
    this._storage = config.storage ?? new InMemorySessionStorage();
    this._model = config.model;
    this._thinkingLevel = config.thinkingLevel ?? "medium";
    this._providerName = config.providerName ?? "default";
    this._sessionId = config.sessionId ?? newEntryId();

    // Load tools, skills, templates, context
    this._tools = config.tools ?? [];

    this._skills = config.skills ?? [];
    this._promptTemplates = config.promptTemplates ?? [];
    this._contextFiles = config.contextFiles ?? [];

    // Build system prompt
    this._systemPrompt = config.system ?? buildSystemPrompt({
      cwd,
      tools: this._tools,
      skills: this._skills,
      customPrompt: config.customSystemPrompt,
      appendPrompt: config.appendSystemPrompt,
      contextFiles: this._contextFiles,
    });

    // Create harness
    this._harness = new AgentHarness({
      provider: config.provider,
      model: config.model,
      system: this._systemPrompt,
      tools: this._tools,
      maxTurns: config.maxTurns,
    }, state.messages);

    // Wire persistence
    this._persistedCount = state.messages.length;
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

    let state: SessionState;
    if (entries.length === 0) {
      // Create initial entries
      const info: SessionEntry = {
        type: "session_info",
        id: newEntryId(),
        parentId: null,
        timestamp: currentTimestamp(),
        cwd: config.cwd,
        createdAt: new Date().toISOString(),
      };
      const modelChange: SessionEntry = {
        type: "model_change",
        id: newEntryId(),
        parentId: info.id,
        timestamp: currentTimestamp(),
        model: config.model,
        providerName: config.providerName,
      };
      const thinkingChange: SessionEntry = {
        type: "thinking_level_change",
        id: newEntryId(),
        parentId: modelChange.id,
        timestamp: currentTimestamp(),
        level: config.thinkingLevel ?? "medium",
      };
      await storage.append(info);
      await storage.append(modelChange);
      await storage.append(thinkingChange);

      // Deferred: don't write the transcript file yet
      state = fromEntries(await storage.readAll());
    } else {
      const leafId = activeLeafId(entries);
      state = fromEntries(entries, leafId);
    }

    // Load tools
    const tools = await createCodingTools(config.cwd);

    // Load resources
    const skills = config.skills ?? [];
    const templates = config.promptTemplates ?? [];
    const contextFiles = config.contextFiles ?? discoverProjectContext(config.cwd);

    // Build system prompt if not explicit
    const system = config.system ?? buildSystemPrompt({
      cwd: config.cwd,
      tools,
      skills,
      customPrompt: config.customSystemPrompt,
      appendPrompt: config.appendSystemPrompt,
      contextFiles,
    });

    const fullConfig: CodingSessionConfig = {
      ...config,
      storage,
      tools,
      skills,
      promptTemplates: templates,
      contextFiles,
      system,
    };

    // Load tools into state before creating the session
    const session = new CodingSession(fullConfig, state);
    return session;
  }

  // -- Core API ---------------------------------------------------------------

  get cwd(): string { return this._config.cwd; }
  get model(): string { return this._model; }
  get providerName(): string { return this._providerName; }
  get tools(): CodingTool[] { return this._tools; }
  get messages(): readonly AgentMessage[] { return this._harness.messages; }
  get state(): SessionState { return this._state; }
  get thinkingLevel(): ThinkingLevel { return this._thinkingLevel; }
  get isRunning(): boolean { return this._harness.isRunning; }
  get sessionId(): string { return this._sessionId; }

  get contextTokenEstimate(): ContextUsageEstimate {
    return estimateContextTokens(this._systemPrompt, this._state.messages, this._tools);
  }

  // -- Prompt -----------------------------------------------------------------

  async *prompt(content: string): AsyncIterable<AgentEvent> {
    const text = this.expandPromptText(content);

    if (this._harness.isRunning) {
      this._harness.steer(text);
      return;
    }

    // Auto-compaction check
    const threshold = this._config.autoCompactTokenThreshold;
    if (threshold != null) {
      const usage = this.contextTokenEstimate;
      if (usage.totalTokens > threshold) {
        await this._compactImpl();
      }
    }

    yield* this._harness.prompt(text);
  }

  async *continue_(): AsyncIterable<AgentEvent> {
    yield* this._harness.continue_();
  }

  // -- Model/Provider management -----------------------------------------------

  async setModel(model: string): Promise<void> {
    this._model = model;
  }

  async setProvider(providerName: string): Promise<void> {
    this._providerName = providerName;
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    this._thinkingLevel = normalizeThinkingLevel(level);
    await this._appendEntry({
      type: "thinking_level_change",
      id: newEntryId(),
      parentId: this._nextParentId,
      timestamp: currentTimestamp(),
      level: this._thinkingLevel,
    });
  }

  // -- Session operations ------------------------------------------------------

  async compact(_instructions?: string): Promise<void> {
    await this._compactImpl();
  }

  async reload(): Promise<void> {
    this._skills = loadSkills([]);
    this._contextFiles = discoverProjectContext(this._config.cwd);
    this._systemPrompt = buildSystemPrompt({
      cwd: this._config.cwd,
      tools: this._tools,
      skills: this._skills,
      contextFiles: this._contextFiles,
    });
  }

  async resume(_sessionId: string): Promise<void> {
    // Stub — Step 40 handles this
  }

  async newSession(): Promise<void> {
    this._sessionId = newEntryId();
    this._persistedCount = 0;
  }

  // -- Commands ---------------------------------------------------------------

  async handleCommand(_text: string): Promise<{ handled: boolean; message?: string }> {
    return { handled: false };
  }

  // -- Terminal commands ------------------------------------------------------

  async runTerminalCommand(_command: string, _addToContext: boolean): Promise<void> {
    // Stub
  }

  // -- Prompt expansion -------------------------------------------------------

  expandPromptText(text: string): string {
    // Try skill expansion first
    const skillResult = expandSkillInvocation(text, this._skills);
    if (skillResult) return skillResult;

    // Try template expansion
    const tmplResult = expandTemplateInvocation(text, this._promptTemplates);
    if (tmplResult) return tmplResult;

    return text;
  }

  // -- Persistence ------------------------------------------------------------

  private _persistMessage(_message: AgentMessage): void {
    this._persistedCount++;
  }

  private async _appendEntry(_entry: SessionEntry): Promise<void> {
    // Stub — will be fully implemented in Step 39
  }

  private async _compactImpl(): Promise<void> {
    const usage = this.contextTokenEstimate;
    const plan = recentPreservingCompactionPlan(this._state.messages);

    if (plan.compact.length === 0) return;

    const summary = summarizeMessagesForCompaction(plan.compact);
    this._harness.replaceMessages([
      { role: "user", content: `Previous conversation summary:\n${summary}` },
      ...plan.keep,
    ]);
  }
}
