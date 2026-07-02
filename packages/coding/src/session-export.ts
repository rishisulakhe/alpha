/**
 * Session export helpers for human-readable transcript views.
 *
 * Supports HTML and JSONL export formats.
 */

import type { SessionEntry, AgentMessage, ToolCall } from "@alpha/agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportFormat = "html" | "jsonl";

export class SessionExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionExportError";
  }
}

// ---------------------------------------------------------------------------
// Export functions
// ---------------------------------------------------------------------------

export function normalizeExportFormat(value: string | undefined): ExportFormat {
  const normalized = (value || "html").trim().toLowerCase().replace(/^\./, "");
  if (normalized === "htm" || normalized === "html") return "html";
  if (normalized === "jsonl") return "jsonl";
  throw new SessionExportError(`Unsupported export format: ${value}`);
}

export function exportSessionJsonl(entries: SessionEntry[], outputPath: string): string {
  const lines = entries.map((e) => JSON.stringify(e));
  const content = lines.join("\n") + (lines.length > 0 ? "\n" : "");

  // Write to file
  const fs = require("node:fs");
  const path = require("node:path");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf-8");

  return outputPath;
}

export function exportSessionHtml(
  entries: SessionEntry[],
  outputPath: string,
  opts?: { title?: string; source?: string },
): string {
  const title = opts?.title ?? "Alpha Session Export";
  const source = opts?.source;

  const html = renderSessionHtml(entries, { title, source });

  // Write to file
  const fs = require("node:fs");
  const path = require("node:path");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, "utf-8");

  return outputPath;
}

export function exportSessionArtifact(
  entries: SessionEntry[],
  outputPath: string,
  opts?: { title?: string; source?: string; format?: string },
): string {
  const format = normalizeExportFormat(opts?.format ?? "html");

  if (format === "jsonl") {
    return exportSessionJsonl(entries, outputPath);
  }
  return exportSessionHtml(entries, outputPath, opts);
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

interface RenderOptions {
  title: string;
  source?: string;
}

export function renderSessionHtml(
  entries: SessionEntry[],
  opts: RenderOptions,
): string {
  const { title, source } = opts;
  const activeLeafId = _activeLeafId(entries);
  const activePathIds = _activePathIds(entries, activeLeafId);
  const treeHtml = _renderTree(entries, activePathIds, activeLeafId);
  const detailsHtml = _renderEntryDetails(entries, activePathIds, activeLeafId);
  const sourceHtml = source
    ? `<p class="source">Source: <code>${_escape(source)}</code></p>`
    : "";
  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${_escape(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f8f7f2;
      --panel: #ffffff;
      --text: #171717;
      --muted: #62615b;
      --border: #d7d3c8;
      --accent: #0b766d;
      --accent-soft: #dff2ed;
      --shadow: rgba(24, 24, 21, 0.08);
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
        sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #121311;
        --panel: #1b1d19;
        --text: #eeeeea;
        --muted: #a9a69d;
        --border: #3c4038;
        --accent: #62c7b6;
        --accent-soft: #153f38;
        --shadow: rgba(0, 0, 0, 0.22);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      padding: 28px clamp(16px, 4vw, 44px) 18px;
      border-bottom: 1px solid var(--border);
    }
    h1, h2, h3, h4 { margin: 0; line-height: 1.2; }
    h1 { font-size: clamp(1.7rem, 3vw, 2.35rem); }
    h2 { font-size: 1rem; margin-bottom: 12px; text-transform: uppercase; }
    h3 { font-size: 1rem; }
    h4 { font-size: 0.9rem; margin-top: 16px; }
    code, pre {
      font-family:
        "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 0.9em;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: color-mix(in srgb, var(--bg) 82%, var(--panel));
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      margin: 10px 0 0;
    }
    .source, .generated {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 0.92rem;
    }
    main {
      display: grid;
      grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
      gap: 20px;
      padding: 20px clamp(16px, 4vw, 44px) 44px;
    }
    aside, article {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 12px 32px var(--shadow);
    }
    aside {
      position: sticky;
      top: 16px;
      align-self: start;
      max-height: calc(100vh - 32px);
      overflow: auto;
      padding: 16px;
    }
    article {
      margin-bottom: 14px;
      padding: 16px;
    }
    .tree {
      list-style: none;
      margin: 0;
      padding-left: 0;
    }
    .tree .tree {
      margin-left: 12px;
      padding-left: 14px;
      border-left: 1px solid var(--border);
    }
    .tree li { margin: 8px 0; }
    .node-link {
      display: block;
      color: var(--text);
      text-decoration: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      background: color-mix(in srgb, var(--panel) 88%, var(--bg));
    }
    .node-link:hover { border-color: var(--accent); }
    .active-path > .node-link {
      border-color: var(--accent);
      background: var(--accent-soft);
    }
    .active-leaf > .node-link {
      box-shadow: inset 3px 0 0 var(--accent);
    }
    .node-type {
      display: block;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .node-meta {
      display: block;
      color: var(--muted);
      font-size: 0.82rem;
      overflow-wrap: anywhere;
    }
    .entry-meta {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 4px 10px;
      margin: 12px 0 0;
      color: var(--muted);
      font-size: 0.88rem;
    }
    .entry-meta dt { font-weight: 700; color: var(--text); }
    .entry-meta dd { margin: 0; overflow-wrap: anywhere; }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .badge {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--muted);
      font-size: 0.78rem;
    }
    .message-role {
      margin-top: 14px;
      font-weight: 700;
      text-transform: capitalize;
    }
    .empty {
      color: var(--muted);
      font-style: italic;
    }
    @media (max-width: 820px) {
      main { grid-template-columns: 1fr; }
      aside { position: static; max-height: none; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${_escape(title)}</h1>
    ${sourceHtml}
    <p class="generated">Generated: <time>${_escape(generatedAt)}</time></p>
  </header>
  <main>
    <aside>
      <h2>Session Tree</h2>
      ${treeHtml}
    </aside>
    <section aria-label="Session entries">
      <h2>Transcript Entries</h2>
      ${detailsHtml}
    </section>
  </main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Tree rendering
// ---------------------------------------------------------------------------

function _activeLeafId(entries: SessionEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type === "leaf") {
      return entry.entryId;
    }
  }
  if (entries.length > 0) {
    return entries[entries.length - 1]!.id;
  }
  return null;
}

function _activePathIds(entries: SessionEntry[], activeLeafId: string | null): Set<string> {
  if (!activeLeafId) return new Set();

  // Simple path finding - walk from leaf to root
  const ids = new Set<string>();
  const byId = new Map(entries.map((e) => [e.id, e]));

  let currentId: string | null = activeLeafId;
  while (currentId) {
    ids.add(currentId);
    const entry = byId.get(currentId);
    if (!entry) break;
    currentId = entry.parentId;
  }

  return ids;
}

function _renderTree(
  entries: SessionEntry[],
  activePathIds: Set<string>,
  activeLeafId: string | null,
): string {
  if (entries.length === 0) {
    return '<p class="empty">No entries.</p>';
  }

  const entryIds = new Set(entries.map((e) => e.id));
  const childrenByParent = new Map<string | null, SessionEntry[]>();

  for (const entry of entries) {
    const parentId = entry.parentId && entryIds.has(entry.parentId) ? entry.parentId : null;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(entry);
    childrenByParent.set(parentId, children);
  }

  // Find roots
  const roots = entries.filter((e) => !e.parentId || !entryIds.has(e.parentId));

  const renderedIds = new Set<string>();
  const nodes: string[] = [];

  for (const root of roots) {
    if (!renderedIds.has(root.id)) {
      nodes.push(_renderTreeNode(root, childrenByParent, activePathIds, activeLeafId, renderedIds));
    }
  }

  // Handle dangling entries
  const dangling = entries.filter((e) => !renderedIds.has(e.id));
  if (dangling.length > 0) {
    const danglingNodes = dangling.map((e) =>
      _renderTreeNode(e, childrenByParent, activePathIds, activeLeafId, renderedIds)
    );
    nodes.push(
      `<li><span class="node-link"><span class="node-type">Unreachable entries</span>` +
      `<span class="node-meta">Entries with cyclic or duplicate tree links.</span></span>` +
      `<ol class="tree">${danglingNodes.join("")}</ol></li>`
    );
  }

  return `<ol class="tree">${nodes.join("")}</ol>`;
}

function _renderTreeNode(
  entry: SessionEntry,
  childrenByParent: Map<string | null, SessionEntry[]>,
  activePathIds: Set<string>,
  activeLeafId: string | null,
  renderedIds: Set<string>,
): string {
  renderedIds.add(entry.id);

  const classes: string[] = ["tree-node"];
  if (activePathIds.has(entry.id)) classes.push("active-path");
  if (entry.id === activeLeafId) classes.push("active-leaf");

  const children = childrenByParent.get(entry.id) ?? [];
  const childHtml = children.length > 0
    ? `<ol class="tree">${
      children
        .filter((c) => !renderedIds.has(c.id))
        .map((c) => _renderTreeNode(c, childrenByParent, activePathIds, activeLeafId, renderedIds))
        .join("")
    }</ol>`
    : "";

  return `<li class="${classes.join(" ")}">` +
    `<a class="node-link" href="#entry-${_attr(entry.id)}">` +
    `<span class="node-type">${_escape(_entryTitle(entry))}</span>` +
    `<span class="node-meta">${_escape(_entrySummary(entry))}</span>` +
    `</a>${childHtml}</li>`;
}

// ---------------------------------------------------------------------------
// Entry details rendering
// ---------------------------------------------------------------------------

function _renderEntryDetails(
  entries: SessionEntry[],
  activePathIds: Set<string>,
  activeLeafId: string | null,
): string {
  if (entries.length === 0) {
    return '<article><p class="empty">No session entries were found.</p></article>';
  }

  return entries
    .map((entry, index) => _renderEntryDetail(index + 1, entry, activePathIds, activeLeafId))
    .join("");
}

function _renderEntryDetail(
  index: number,
  entry: SessionEntry,
  activePathIds: Set<string>,
  activeLeafId: string | null,
): string {
  const badges: string[] = [];
  if (activePathIds.has(entry.id)) badges.push("active path");
  if (entry.id === activeLeafId) badges.push("active leaf");

  const badgeHtml = badges.length > 0
    ? `<div class="badges">${badges.map((b) => `<span class="badge">${_escape(b)}</span>`).join("")}</div>`
    : "";

  const body = _renderEntryBody(entry);
  const parentHtml = entry.parentId
    ? `<a href="#entry-${_attr(entry.parentId)}"><code>${_escape(entry.parentId)}</code></a>`
    : '<span class="empty">root</span>';

  return `<article id="entry-${_attr(entry.id)}">` +
    `<h3>${index}. ${_escape(_entryTitle(entry))}</h3>` +
    badgeHtml +
    `<dl class="entry-meta">` +
    `<dt>id</dt><dd><code>${_escape(entry.id)}</code></dd>` +
    `<dt>parent</dt><dd>${parentHtml}</dd>` +
    `<dt>timestamp</dt><dd>${_escape(String(entry.timestamp))}</dd>` +
    `</dl>${body}</article>`;
}

function _renderEntryBody(entry: SessionEntry): string {
  switch (entry.type) {
    case "message":
      return _renderMessageEntry(entry);
    case "model_change":
      return `<p>Model changed to <code>${_escape(entry.model)}</code>.</p>`;
    case "thinking_level_change":
      return `<p>Thinking level changed to <code>${_escape(entry.level ?? "off")}</code>.</p>`;
    case "compaction":
      return `<p>Compaction summary:</p><pre>${_escape(entry.summary)}</pre>` +
        (entry.replacesEntryIds?.length
          ? `<h4>Replaces entries</h4><ul>${
            entry.replacesEntryIds.map((id) => `<li><code>${_escape(id)}</code></li>`).join("")
          }</ul>`
          : "");
    case "branch_summary":
      return `<p>Branch summary</p><pre>${_escape(entry.summary)}</pre>`;
    case "label":
      return `<p>Session label: <strong>${_escape(entry.label)}</strong></p>`;
    case "leaf":
      return `<p>Active leaf pointer: <code>${_escape(entry.entryId ?? "none")}</code></p>`;
    case "session_info":
      return `<p>Title: <strong>${_escape(entry.name ?? entry.title ?? "Untitled")}</strong></p>` +
        `<p>Working directory: <code>${_escape(entry.cwd ?? "unknown")}</code></p>` +
        `<p>Created: ${_escape(entry.createdAt ?? "unknown")}</p>`;
    case "custom":
      return `<p>Custom namespace: <code>${_escape(entry.namespace)}</code></p>` +
        `<pre>${_escape(JSON.stringify(entry.data, null, 2))}</pre>`;
    default:
      return `<pre>${_escape(JSON.stringify(entry, null, 2))}</pre>`;
  }
}

function _renderMessageEntry(entry: SessionEntry & { type: "message" }): string {
  const msg = entry.message;

  switch (msg.role) {
    case "user":
      return `<p class="message-role">user</p><pre>${_escape(msg.content)}</pre>`;

    case "assistant": {
      const toolCallsHtml = msg.tool_calls?.length
        ? `<h4>Tool calls</h4><ul>${
          msg.tool_calls.map((tc) =>
            `<li><code>${_escape(tc.name)}</code> <code>${_escape(tc.id)}</code>` +
            `<pre>${_escape(JSON.stringify(tc.arguments, null, 2))}</pre></li>`
          ).join("")
        }</ul>`
        : "";
      const content = msg.content || "(no assistant text)";
      return `<p class="message-role">assistant</p><pre>${_escape(content)}</pre>${toolCallsHtml}`;
    }

    case "tool": {
      const metadata: Array<[string, string]> = [
        ["tool", msg.name],
        ["tool_call_id", msg.tool_call_id],
        ["ok", String(msg.ok)],
      ];
      if (msg.error) {
        metadata.push(["error", msg.error]);
      }
      let body = `<p class="message-role">tool result</p>${
        _renderMetadata(metadata)
      }<pre>${_escape(msg.content)}</pre>`;
      if (msg.data) {
        body += `<h4>Data</h4><pre>${_escape(JSON.stringify(msg.data, null, 2))}</pre>`;
      }
      if (msg.details) {
        body += `<h4>Details</h4><pre>${_escape(JSON.stringify(msg.details, null, 2))}</pre>`;
      }
      return body;
    }

    default:
      return `<pre>${_escape(JSON.stringify(msg, null, 2))}</pre>`;
  }
}

function _renderMetadata(items: Array<[string, string]>): string {
  return `<dl class="entry-meta">${
    items.map(([key, value]) =>
      `<dt>${_escape(key)}</dt><dd><code>${_escape(value)}</code></dd>`
    ).join("")
  }</dl>`;
}

// ---------------------------------------------------------------------------
// Entry helpers
// ---------------------------------------------------------------------------

function _entryTitle(entry: SessionEntry): string {
  switch (entry.type) {
    case "message":
      return `message:${entry.message.role}`;
    case "model_change":
      return "model change";
    case "thinking_level_change":
      return "thinking level change";
    case "compaction":
      return "compaction";
    case "branch_summary":
      return "branch summary";
    case "label":
      return "label";
    case "leaf":
      return "leaf pointer";
    case "session_info":
      return "session info";
    case "custom":
      return `custom:${entry.namespace}`;
    default:
      return (entry as { type: string }).type;
  }
}

function _entrySummary(entry: SessionEntry): string {
  switch (entry.type) {
    case "message": {
      const msg = entry.message;
      if (msg.role === "tool") {
        return `${msg.name}: ${_summarizeText(msg.content)}`;
      }
      if (msg.role === "assistant" && msg.tool_calls?.length) {
        const toolNames = msg.tool_calls.map((tc) => tc.name).join(", ");
        const text = _summarizeText(msg.content) || "tool call";
        return `${text} [${toolNames}]`;
      }
      return _summarizeText(msg.content);
    }
    case "model_change":
      return entry.model;
    case "thinking_level_change":
      return entry.level ?? "off";
    case "compaction":
      return _summarizeText(entry.summary);
    case "branch_summary":
      return _summarizeText(entry.summary);
    case "label":
      return entry.label;
    case "leaf":
      return entry.entryId ?? "none";
    case "session_info":
      return entry.name ?? entry.title ?? entry.cwd ?? "session metadata";
    case "custom":
      return `${Object.keys(entry.data).length} field(s)`;
    default: {
      const e = entry as SessionEntry;
      return e.id;
    }
  }
}

function _summarizeText(text: string, limit = 92): string {
  const summary = text.replace(/\s+/g, " ").trim();
  if (summary.length <= limit) return summary;
  return summary.slice(0, limit - 3).trim() + "...";
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function _formatTimestamp(timestamp: number): string {
  try {
    const date = new Date(timestamp * 1000); // Convert from seconds
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch {
    return String(timestamp);
  }
}

function _escape(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function _attr(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
