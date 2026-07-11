# Coding Agent TUI — Design Spec (Tau-architecture, built on OpenTUI)

Use this as a build prompt / spec for an AI coding agent (or for yourself) implementing
a terminal UI in the style of Hugging Face's **tau** (`tau_coding/tui`), but on top of
**OpenTUI** (`@opentui/core`, Zig core + Yoga flexbox + tree-sitter + React/Solid bindings)
instead of Python/Textual.

The core idea to preserve from tau: **strict layering**. The agent "brain" never touches
rendering. The TUI is just one consumer of a typed event stream. Design the UI layer
against that contract first, then wire it up.

---

## 0. Architectural contract (non-negotiable)

```
provider/model streaming layer   → emits raw token/tool deltas
agent harness (loop + tools)     → emits typed AgentEvents (no UI knowledge)
app/session layer                → owns CLI, TUI, slash commands, config, resources
TUI (OpenTUI)                    → pure renderer + input capture, subscribes to events
```

- The TUI must be swappable for a "print mode" (plain stdout/JSON) without touching the
  harness. If you can't run headless, the layering is wrong.
- Define an `AgentEvent` union up front (turn start/end, message delta, tool call start,
  tool call result/streaming-output, thinking delta, error, usage/token update, session
  event) and build every widget as a subscriber to that stream — never let a widget poll
  or reach into agent state directly.
- Sessions are append-only JSONL, replayable into UI state on load. The TUI should be able
  to reconstruct its entire transcript from the event log alone.

---

## 1. Screen layout

```
┌─────────────────────────────────────────────────────────────┐
│ Header / status bar: model, provider, cwd, git branch,       │
│ context-window usage bar, thinking-mode indicator            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Scrollable transcript (chat + tool activity + diffs)        │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│ Ephemeral status line (streaming spinner, "Reading file.ts…")│
├─────────────────────────────────────────────────────────────┤
│ Prompt input box (multiline, autocomplete popovers above it) │
├─────────────────────────────────────────────────────────────┤
│ Footer: keybind hints, token count, queued-message indicator │
└─────────────────────────────────────────────────────────────┘
```

Build this with OpenTUI `Box` + `flexDirection: "column"`, transcript region as a
`ScrollBox` with `flexGrow: 1`, everything else fixed-height. Use the Yoga flexbox
layout rather than manual coordinate math.

---

## 2. Streaming transcript / chat view

- **Token-level streaming**: assistant text renders incrementally as `MessageDelta`
  events arrive — don't wait for the full message. Use OpenTUI's `Text` node and mutate
  its content, or append delta chunks to a buffer and re-render on a throttled tick
  (e.g. 30–60ms) to avoid redraw thrash.
- **Markdown rendering while streaming**: partial markdown must not visually break
  (unclosed code fences, unclosed bold, etc.) — buffer at line/paragraph boundaries or
  do incremental re-parse of the whole buffer per tick rather than trying to patch
  markdown AST diffs.
- **Syntax-highlighted code blocks**: use OpenTUI's built-in tree-sitter `Code` component
  for fenced code blocks; detect language from the fence info string.
- **Tool-call blocks**: distinct visual treatment from chat text — a collapsible card
  showing tool name, args (pretty-printed/truncated), live output as it streams (e.g.
  bash stdout), and a final status glyph (✓ success / ✗ error / ⋯ running).
- **Diff viewer for file edits**: dedicated component (tau added this as a "diff viewer
  modal with a dedicated patch slot") — unified-diff or side-by-side, syntax highlighted,
  collapsible per-file, expandable to full modal for large diffs.
- **Thinking/reasoning stream**: separate visual channel (dim/italic, collapsible) for
  `ThinkingDelta` events, toggleable, distinguished from final answer text.
- **Auto-scroll with escape hatch**: pin to bottom while streaming; if the user scrolls
  up to read history, stop auto-scrolling and show a "↓ new output" affordance instead
  of yanking them back down.
- **Message boundaries**: visually separate turns (user / assistant / tool / system) via
  color, icon, or indent — don't rely on whitespace alone.

---

## 3. Prompt input box

- Multiline text input (`Input` or a custom `TextArea` on OpenTUI — grows with content
  up to a max height, then scrolls internally).
- **Submit**: Enter sends; Shift+Enter (or a configurable alt key) inserts a newline.
- **Message queueing**: if the user submits while the agent is still streaming a
  response, queue the message and show a small "1 queued" indicator instead of blocking
  input or dropping the message.
- **Interrupt**: a keybind (e.g. Esc or Ctrl+C once) cancels the in-flight turn without
  killing the whole app; a second press exits.
- **Paste handling**: large pastes (e.g. stack traces, whole files) should collapse into
  a placeholder chip ("[pasted 480 lines]") rather than flooding the input box.
- **File/image drag-in or `@`-reference**: typing `@` opens a fuzzy file picker
  (project-relative paths) that inserts a reference token; resolve to file contents when
  the message is sent, not at keystroke time.
- **History navigation**: Up/Down cycles through previously submitted prompts when the
  input is empty (shell-style).

---

## 4. Slash commands

- Typing `/` at the start of the input opens a **command palette popover** anchored
  above the input box, filtered as you type, arrow-key navigable, Tab/Enter to accept.
- Built-in commands to support at minimum (mirroring tau): `/help`, `/exit` (or
  `/quit`), `/clear`, `/status`, `/sessions`, `/resume`, `/model`, `/provider`,
  `/login`, `/skills`, `/skill <name>`, `/compact` (context compaction).
- Commands are a **registry owned by the app layer**, not the harness — the palette UI
  just renders whatever's registered, including user-defined/extension commands, so the
  UI code shouldn't hardcode the list.
- Show inline argument hints once a command is selected (e.g. `/model <provider/name>`).
- Support command **aliases** and fuzzy matching, not just prefix matching.

---

## 5. Autocomplete / popovers (general pattern)

Build one reusable "popover menu" primitive and reuse it for:
- slash-command palette (`/`)
- `@`-file picker
- model/provider picker (`/model`, `/provider`)
- session picker (`/sessions`, `/resume`)
- skill picker (`/skill`)

Each popover: fuzzy-filterable list, keyboard-only navigation (↑/↓/Tab/Enter/Esc),
renders above the input so it never gets clipped by terminal bottom edge, closes on
Esc or on selection.

---

## 6. Status / header bar

- Active model + provider, editable via `/model` shortcut or click-through if OpenTUI
  supports mouse events.
- **Context/token usage bar**: recompute after every user message, assistant response,
  tool call, and compaction event — not just at turn boundaries. Show as a small
  proportion bar plus raw numbers (e.g. `42k / 200k`).
- **Thinking-mode toggle indicator**: show current mode (off/low/high); bind to a
  dedicated key (tau uses Shift-Tab) to cycle it; persist the choice per-session rather
  than silently resetting.
- Git branch / dirty-state indicator if inside a repo (nice-to-have, cheap signal).
- Session name/id, so users always know which transcript they're in.

---

## 7. Footer / keybind hints

- Persistent, low-contrast strip showing the 3–5 most relevant keybinds for current
  mode (e.g. `Enter send · Shift+Enter newline · Esc cancel · Shift+Tab thinking · /help`).
- Update contents contextually (e.g. while a popover is open, show its own hints instead).

---

## 8. Modals / overlays

- Full-screen or centered modal primitive, reused for: large diff view, session
  browser, settings/provider config, help screen.
- Modals must trap focus (Tab cycles within them) and close on Esc without losing
  underlying transcript scroll position.
- Diff modal specifically needs its own scrollable region independent of the main
  transcript, syntax highlighting via the `Code`/`Diff` component, and a way to jump
  between changed files.

---

## 9. Ephemeral status line

- Single-line, above the input box, shows the *current* agent activity: spinner +
  verb-phrase ("Reading `src/app.ts`…", "Running `pytest`…", "Thinking…").
- Cleared the moment the activity resolves; does not accumulate — it's a live indicator,
  not a log (the log lives in the transcript).

---

## 10. Session management UI

- `/sessions` opens a picker: list of past sessions with title/summary, last-modified
  time, message count, token usage — sourced from the append-only JSONL store.
- `/resume` reconstructs full TUI state (transcript, tool cards, diffs, thinking blocks)
  purely by replaying the event log — proves the log is a complete source of truth.
- Session export (tau added an HTML export) is a good stretch goal: render transcript +
  diffs to a static, shareable file.

---

## 11. Rendering performance notes (OpenTUI-specific)

- Don't re-render the whole transcript tree on every token; mutate the trailing message
  node in place and let OpenTUI's diffing/Yoga layout handle relayout.
- Throttle high-frequency deltas (token stream, tool stdout stream) to a fixed tick
  rather than rendering every single chunk — terminals have real redraw cost.
- Use `ScrollBox` virtualization if transcripts get long; don't keep every historical
  message as a fully mounted, styled node forever.
- If using the React or Solid bindings, keep state updates batched per animation frame;
  if using core directly, manage your own dirty-flag + render-loop tick.

---

## 12. Suggested build order

1. Static layout skeleton (header/transcript/status/input/footer) with dummy content.
2. Wire a fake `AgentEvent` stream (local generator) into the transcript to prove
   streaming + markdown + auto-scroll before touching a real provider.
3. Prompt input: submit, multiline, history, interrupt, queueing.
4. Slash-command palette + `@`-file popover using one shared popover primitive.
5. Tool-call cards + diff viewer.
6. Status bar (tokens, thinking mode, model) wired to real event data.
7. Session persistence + `/sessions`/`/resume` replay.
8. Modals, export, polish (colors, spinners, empty states, error states).

---

### Reference

- tau architecture/roadmap: https://github.com/huggingface/tau (see issue #1 for the
  phase-by-phase TUI build log, and the `tau_coding/tui` source for the Textual
  implementation you're porting the *concepts* from — not the code, since you're on
  OpenTUI/TypeScript).
- OpenTUI docs: https://opentui.com/docs/getting-started — flexbox layout, `Text`,
  `Box`, `Input`, `Select`, `ScrollBox`, `Code`/`Diff` components, focus/keyboard
  handling, and the animation Timeline API.