/**
 * Truncation utilities for tool output.
 *
 * Matches Tau's truncation behavior with detailed metadata
 * about how output was shortened.
 */

// ---------------------------------------------------------------------------
// Constants (matching Tau defaults)
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_OUTPUT_LINES = 2000;
export const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024; // 50KB

// ---------------------------------------------------------------------------
// TruncationResult
// ---------------------------------------------------------------------------

/**
 * Metadata describing how tool output was shortened.
 *
 * `content` contains the returned slice. The remaining fields record whether
 * truncation happened, whether the line or byte limit was responsible, the
 * total size of the original output, the size of the returned output, and
 * edge cases such as partial-line output or a first line that is too large.
 */
export interface TruncationResult {
  /** The truncated content */
  content: string;
  /** Whether truncation occurred */
  truncated: boolean;
  /** What caused truncation: 'lines' or 'bytes' */
  truncatedBy: "lines" | "bytes" | null;
  /** Total lines in original content */
  totalLines: number;
  /** Total bytes in original content */
  totalBytes: number;
  /** Lines in output */
  outputLines: number;
  /** Bytes in output */
  outputBytes: number;
  /** Whether last line is partial (byte truncation mid-line) */
  lastLinePartial: boolean;
  /** Whether first line exceeds byte limit */
  firstLineExceedsLimit: boolean;
  /** Max lines configured */
  maxLines: number;
  /** Max bytes configured */
  maxBytes: number;
}

// ---------------------------------------------------------------------------
// truncateHead - for read tool (showing from beginning)
// ---------------------------------------------------------------------------

/**
 * Truncate from the head (beginning) of content.
 * Used by the read tool to show the start of a file.
 */
export function truncateHead(
  content: string,
  opts?: { maxLines?: number; maxBytes?: number },
): TruncationResult {
  const maxLines = opts?.maxLines ?? DEFAULT_MAX_OUTPUT_LINES;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const lines = splitLinesForCounting(content);
  const totalLines = lines.length;
  const totalBytes = new TextEncoder().encode(content).length;

  // No truncation needed
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return truncationResult(content, false, null, totalLines, totalBytes, totalLines, totalBytes);
  }

  // Check if first line exceeds byte limit
  const firstLineBytes = lines[0] ? new TextEncoder().encode(lines[0]).length : 0;
  if (firstLineBytes > maxBytes) {
    return truncationResult("", true, "bytes", totalLines, totalBytes, 0, 0, { firstLine: true });
  }

  // Build output within limits
  const outputLines: string[] = [];
  let outputBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";

  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const line = lines[i]!;
    const lineBytes = new TextEncoder().encode(line).length + (i > 0 ? 1 : 0); // +1 for newline

    if (outputBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }

    outputLines.push(line);
    outputBytes += lineBytes;
  }

  const output = outputLines.join("\n");
  return truncationResult(
    output,
    true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines.length,
    new TextEncoder().encode(output).length,
  );
}

// ---------------------------------------------------------------------------
// truncateTail - for bash tool (showing from end)
// ---------------------------------------------------------------------------

/**
 * Truncate from the tail (end) of content.
 * Used by the bash tool to show the end of command output.
 */
export function truncateTail(
  content: string,
  opts?: { maxLines?: number; maxBytes?: number },
): TruncationResult {
  const maxLines = opts?.maxLines ?? DEFAULT_MAX_OUTPUT_LINES;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const lines = splitLinesForCounting(content);
  const totalLines = lines.length;
  const totalBytes = new TextEncoder().encode(content).length;

  // No truncation needed
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return truncationResult(content, false, null, totalLines, totalBytes, totalLines, totalBytes);
  }

  // Build output from end within limits
  const outputLines: string[] = [];
  let outputBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";
  let lastLinePartial = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const lineBytes = new TextEncoder().encode(line).length + (outputLines.length > 0 ? 1 : 0);

    if (outputLines.length >= maxLines) {
      truncatedBy = "lines";
      break;
    }

    if (outputBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      // If this is the first line we're adding and it's too big, clip it
      if (outputLines.length === 0) {
        const clipped = truncateStringToBytesFromEnd(line, maxBytes);
        outputLines.unshift(clipped);
        outputBytes = new TextEncoder().encode(clipped).length;
        lastLinePartial = true;
      }
      break;
    }

    outputLines.unshift(line);
    outputBytes += lineBytes;
  }

  const output = outputLines.join("\n");
  return truncationResult(
    output,
    true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines.length,
    new TextEncoder().encode(output).length,
    { lastLinePartial },
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format byte count for display (e.g., "50.0KB") */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function splitLinesForCounting(content: string): string[] {
  if (!content) return [];

  // Split on newlines, preserving the behavior that trailing newline means last empty is dropped
  const lines = content.split("\n");
  if (content.endsWith("\n") && lines.length > 0) {
    lines.pop();
  }
  return lines;
}

function truncationResult(
  content: string,
  truncated: boolean,
  truncatedBy: "lines" | "bytes" | null,
  totalLines: number,
  totalBytes: number,
  outputLines: number,
  outputBytes: number,
  opts?: { lastLinePartial?: boolean; firstLine?: boolean },
): TruncationResult {
  return {
    content,
    truncated,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines,
    outputBytes,
    lastLinePartial: opts?.lastLinePartial ?? false,
    firstLineExceedsLimit: opts?.firstLine ?? false,
    maxLines: DEFAULT_MAX_OUTPUT_LINES,
    maxBytes: DEFAULT_MAX_OUTPUT_BYTES,
  };
}

function truncateStringToBytesFromEnd(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length <= maxBytes) return text;

  const clipped = encoded.slice(-maxBytes);
  // Decode with error handling for potential partial character
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return decoder.decode(clipped);
}
