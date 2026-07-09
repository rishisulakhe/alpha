# Alpha

A minimal coding agent built in TypeScript, inspired by [Pi](https://github.com/earendil-works/pi).

Alpha understands your codebase, runs tools (bash, read/write/edit files), and reports back in a streaming terminal UI.

## Architecture

Three packages in a monorepo:

```
packages/
  ai/       Layer 1 — LLM provider adapters (OpenAI, Anthropic, OpenRouter)
  agent/    Layer 2 — Agent harness, event loop, session storage
  coding/   Layer 3 — Application: CLI, TUI, tools, commands, config
```

Data flows in one direction: **Provider → ProviderEvents → AgentEvents → TUI**

## Quick Start

```bash
bun install

# Set an API key (pick one)
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export OPENROUTER_API_KEY=sk-or-...

# Launch the TUI
bun run packages/coding/src/cli.ts

# Or use print mode
bun run packages/coding/src/cli.ts -p "Explain the architecture of this project"
```

## Commands

In the TUI, type `/` to access slash commands:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model [name]` | Show or set the active model |
| `/thinking [level]` | Show or set thinking mode (off/minimal/low/medium/high/xhigh) |
| `/compact` | Summarize and compact context windows |
| `/session` | Show session info |
| `/new` | Start a fresh session |
| `/resume [id]` | Resume a previous session |
| `/export` | Export session as HTML or JSONL |
| `/tree` | Show branch points |
| `/quit` | Exit |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Enter | Submit prompt (or steer while agent is running) |
| Tab | Cycle thinking level |
| Up/Down | Scroll transcript |
| PgUp/PgDn | Scroll by page |
| Esc | Cancel current run |
| Ctrl+D | Quit |

## Development

```bash
bun run typecheck   # Type-check all packages
bun run test        # Run all tests
bun run lint        # Lint with Biome
```

## CLI Flags

```
--prompt, -p      Run in print mode (non-interactive)
--model           Override the model
--provider        Override the provider
--resume          Resume latest session
--new-session     Start a fresh session
--output          Print mode format: text | json | transcript
--cwd             Set working directory
```

## Session Storage

Sessions are persisted as append-only JSONL files in `~/.alpha/sessions/`. Each project has its own directory, and sessions support branching from any point in history.
