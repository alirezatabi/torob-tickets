/**
 * Minimal OpenAI-compatible chat client.
 *
 * Deliberately tiny: no SDK, one `fetch`, a hard timeout, and a clear "not
 * configured" state. Every caller must handle `null` by falling back to the
 * deterministic implementation — the product is fully functional offline.
 */

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function llmConfig(): LlmConfig | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
  };
}

export function isLlmEnabled(): boolean {
  return llmConfig() !== null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResult {
  text: string;
  model: string;
  latencyMs: number;
}

/**
 * Ask for a JSON object. Returns `null` on any failure (missing key, network,
 * timeout, malformed envelope) so callers can degrade gracefully.
 */
export async function completeJson(
  messages: ChatMessage[],
  options: { temperature?: number; timeoutMs?: number } = {},
): Promise<LlmResult | null> {
  const config = llmConfig();
  if (!config) return null;

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 9_000);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: options.temperature ?? 0.2,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const text = extractContent(payload);
    if (!text) return null;
    return { text, model: config.model, latencyMs: Date.now() - startedAt };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first?.message?.content;
  return typeof content === "string" && content.trim().length > 0 ? content : null;
}

/** Parse a JSON object out of occasionally-fenced model output. */
export function parseJsonObject(text: string): unknown {
  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(withoutFence.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
