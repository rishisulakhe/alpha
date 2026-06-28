import type { ModelProvider, ProviderEvent } from "@alpha/ai";
import { OpenAICompatibleProvider } from "@alpha/ai/providers/openai-compatible";

// ---------------------------------------------------------------------------
// echoProvider — always returns a fixed mock response (used when no API key)
// ---------------------------------------------------------------------------

export function echoProvider(model?: string): ModelProvider {
  const name = model ?? "echo";
  return {
    async *streamResponse(): AsyncIterable<ProviderEvent> {
      yield { type: "response_start", model: name } satisfies ProviderEvent;
      yield { type: "text_delta", text: "Hello! I'm a demo response. Set OPENROUTER_API_KEY or OPENAI_API_KEY to use a real LLM." } satisfies ProviderEvent;
      yield {
        type: "response_end",
        message: { role: "assistant", content: "Hello! I'm a demo response. Set OPENROUTER_API_KEY or OPENAI_API_KEY to use a real LLM.", tool_calls: [] },
        finishReason: "stop",
      } satisfies ProviderEvent;
    },
  };
}

// ---------------------------------------------------------------------------
// createProvider — create a real provider when API key is set, fallback to echo
// ---------------------------------------------------------------------------

export function createProvider(opts?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): ModelProvider {
  const apiKey = opts?.apiKey ?? process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
  const baseUrl = opts?.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const model = opts?.model ?? process.env.ALPHA_MODEL ?? "openai/gpt-4o";

  if (apiKey) {
    process.stderr.write(`[alpha] Using provider with model=${model} baseUrl=${baseUrl}\n`);
    return new OpenAICompatibleProvider({
      apiKey,
      baseUrl,
      headers: {
        "HTTP-Referer": "https://alpha.dev",
        "X-Title": "Alpha Coding Agent",
      },
      maxRetries: 2,
      maxRetryDelaySeconds: 30,
      timeoutSeconds: 120,
    });
  }

  // Fallback to demo mode
  process.stderr.write("[alpha] No API key found. Using demo mode. Set OPENROUTER_API_KEY for real LLM.\n");
  return echoProvider(model);
}
