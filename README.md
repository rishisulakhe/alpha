# Alpha

An interactive coding agent for the terminal, written in TypeScript. Alpha reads your codebase, edits files, runs shell commands, and streams everything through a live terminal UI. Built with [Bun](https://bun.sh) and [Ink](https://github.com/vadimdemedes/ink).

## Packages

| Package | Description |
|---------|-------------|
| **[@alpha/ai](packages/ai)** | LLM provider adapters — OpenAI-compatible, Anthropic |
| **[@alpha/agent](packages/agent)** | Agent engine — event loop, tool execution, session persistence |
| **[@alpha/coding](packages/coding)** | Application layer — CLI, TUI, coding tools, slash commands |

Data flows in one direction: **Provider → ProviderEvents → AgentEvents → TUI**

## Quick Start

Requires [Bun](https://bun.sh).

```bash
bun install

# Set an API key (pick one)
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export OPENROUTER_API_KEY=sk-or-...

# Launch the TUI
bun run packages/coding/src/cli.ts

# One-shot print mode
bun run packages/coding/src/cli.ts -p "Explain the architecture of this project"
```

### CLI Flags

```
-p, --prompt       Run in print mode (non-interactive)
--model            Override the model
--provider         Override the provider
--resume           Resume the latest session
--new-session      Start a fresh session
--output           Print mode format: text | json | transcript
--cwd              Set working directory
```

### Toolset

Alpha has four built-in tools: **read**, **write**, **edit**, and **bash**. The agent decides which tools to call based on your prompt. All tools run within the current working directory — path traversal is blocked.

## TUI

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model [name]` | Show or set the active model |
| `/thinking [level]` | Set thinking mode (off, minimal, low, medium, high, xhigh) |
| `/compact` | Summarize and compact context |
| `/session` | Show session info |
| `/new` | Start a fresh session |
| `/resume [id]` | Resume a previous session |
| `/export` | Export session as HTML or JSONL |
| `/tree` | Show branch points |
| `/quit` | Exit |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Enter | Submit prompt (or steer a running agent) |
| Tab | Cycle thinking level |
| Up / Down | Scroll transcript |
| PgUp / PgDn | Scroll by page |
| Esc | Cancel current run |
| Ctrl+D | Quit |

Terminal commands can be run directly with `!` (include in context) or `!!` (fire-and-forget).

## Permissions

Alpha does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the same permissions as the user and process that launched it. If you need stronger isolation, run Alpha in a container or sandbox.

## Session Storage

Sessions are persisted as append-only JSONL files in `~/.alpha/sessions/`. Each project gets its own directory. The session tree supports branching — you can fork from any point in history and switch branches at runtime.

## Development

```bash
bun run typecheck   # Type-check all packages
bun run test        # Run all tests
bun run lint        # Lint with Biome
bun run check       # Format + lint + typecheck + test
```

Pre-commit hooks (via Husky) run Biome formatting on staged files, followed by full lint, typecheck, and tests before every commit.

## Contributing

See [AGENTS.md](AGENTS.md) for project conventions and architecture rules. Contributions are welcome.

## License

MIT
