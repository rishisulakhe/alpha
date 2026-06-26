// ---------------------------------------------------------------------------
// SSE line parsing
// ---------------------------------------------------------------------------

export function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) return null;
  return trimmed.slice("data:".length).trim();
}

// ---------------------------------------------------------------------------
// ReadableStream SSE parser — yields JSON objects from an SSE response body
// ---------------------------------------------------------------------------

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const data = parseSseLine(line);
        if (data === "[DONE]") return;
        if (data !== null) yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Safe JSON parsing
// ---------------------------------------------------------------------------

export function safeJsonParse<T = Record<string, unknown>>(text: string): T | null {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) return parsed as T;
    return null;
  } catch {
    return null;
  }
}
