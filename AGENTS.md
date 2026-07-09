# AGENTS.md — Alpha Project Conventions

## Language & Runtime

- TypeScript 5.x, strict mode
- Bun runtime (builds, tests, package management)
- ESM modules only (no CJS)

## Project Structure

```
packages/
  ai/src/         Provider adapters — never import from @alpha/agent or @alpha/coding
    events.ts     ProviderEvent types (Zod-validated)
    provider.ts   ModelProvider interface
    messages.ts   Message types (AgentMessage, AssistantMessage, etc.)
    providers/    OpenAI-compatible, Anthropic adapter implementations

  agent/src/      Agent engine — imports from @alpha/ai only
    loop.ts       runAgentLoop() — pure async generator, yields AgentEvent
    harness.ts    AgentHarness — stateful wrapper with queues, cancellation
    messages.ts   Re-exports from @alpha/ai/messages.ts
    tools.ts      AgentTool interface
    session/      JSONL persistence, tree traversal, state reconstruction

  coding/src/     Application layer — imports from @alpha/agent
    cli.ts        CLI entry (parseArgs, subcommand dispatch)
    session.ts    CodingSession — orchestrator wrapping AgentHarness
    tui/          Ink (React) terminal UI
    tools/        Coding-specific tools: read, write, edit, bash
    config/       Provider config, credentials, paths
    commands.ts   Slash command registry
```

## Architecture Rules

1. **Data flows in one direction**: Provider → ProviderEvents → AgentEvents → TUI
2. **@alpha/ai never imports runtime code from @alpha/agent** — type-only imports are OK
3. **Agent events are provider-neutral** — no OpenAI/Anthropic-specific fields
4. **No `require()`** — use ESM `import` for all modules including `node:*` builtins
5. **Errors are logged, not swallowed** — catch blocks should include `console.error`

## Code Style

- No comments unless they explain WHY, not WHAT
- Prefer explicit return types on public functions
- Use Zod for runtime validation of external data (events, messages, config)
- Async generators (`async function*`) for streaming event sources
- `useCallback` / `useRef` in React hooks, avoid inline functions in JSX

## Testing

```bash
bun test          # Run all packages
bun test --watch  # Watch mode
bun run check     # Format + lint + typecheck + test (runs on pre-commit)
```

Tests use `bun:test` (Jest-compatible). Provider tests use `FakeProvider` to avoid network calls. Session storage tests use `InMemorySessionStorage`.

Pre-commit hooks (via Husky) run Biome formatting on staged files, then full lint + typecheck + tests before every commit.

## Adding a Provider

1. Implement `ModelProvider.streamResponse()` → `AsyncIterable<ProviderEvent>`
2. Handle SSE parsing, tool call accumulation, thinking extraction
3. Add to `provider-runtime.ts` factory function
4. Add to provider catalog in `providers.ts`

## Adding a Tool

1. Implement `AgentTool` interface (name, description, input_schema, execute)
2. Add `prompt_snippet` and `prompt_guidelines` for the system prompt
3. Register in `createCodingTools()` factory
