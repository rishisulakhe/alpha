// ---------------------------------------------------------------------------
// Thinking levels
// ---------------------------------------------------------------------------

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const ALL_THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

// ---------------------------------------------------------------------------
// normalizeThinkingLevel
// ---------------------------------------------------------------------------

export function normalizeThinkingLevel(
  level: string | undefined,
  defaultLevel: ThinkingLevel = "medium",
): ThinkingLevel {
  if (!level) return defaultLevel;
  const normalized = level.toLowerCase().trim();
  if (ALL_THINKING_LEVELS.includes(normalized as ThinkingLevel)) {
    return normalized as ThinkingLevel;
  }
  throw new Error(`Unknown thinking level: ${level}`);
}

// ---------------------------------------------------------------------------
// nextThinkingLevel
// ---------------------------------------------------------------------------

export function nextThinkingLevel(
  current: ThinkingLevel,
  available: ThinkingLevel[],
): ThinkingLevel {
  const idx = available.indexOf(current);
  if (idx === -1) return available[0] ?? "off";
  return available[(idx + 1) % available.length]!;
}

// ---------------------------------------------------------------------------
// reasoningEffortForLevel
// ---------------------------------------------------------------------------

export function reasoningEffortForLevel(level: ThinkingLevel): string {
  if (level === "off") return "none";
  return level;
}

// ---------------------------------------------------------------------------
// anthropicThinkingBudgetForLevel
// ---------------------------------------------------------------------------

export function anthropicThinkingBudgetForLevel(level: ThinkingLevel): number | null {
  switch (level) {
    case "off": return null;
    case "minimal": return 1024;
    case "low": return 2048;
    case "medium": return 4096;
    case "high": return 8192;
    case "xhigh": return 16384;
  }
}

// ---------------------------------------------------------------------------
// providerThinkingLevels
// ---------------------------------------------------------------------------

export function providerThinkingLevels(
  thinkingLevels?: string[],
): ThinkingLevel[] {
  if (!thinkingLevels || thinkingLevels.length === 0) return [];
  return thinkingLevels
    .map((l) => l.toLowerCase().trim())
    .filter((l): l is ThinkingLevel => ALL_THINKING_LEVELS.includes(l as ThinkingLevel));
}
