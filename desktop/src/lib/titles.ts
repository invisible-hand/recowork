/**
 * One-shot title generator. Calls Baseten's Anthropic-compatible /v1/messages
 * with a tiny prompt and returns a 2–5 word topic.
 *
 * Costs a few hundred input tokens + ~20 output per call. Fires once per
 * session after the first turn completes.
 */

export async function generateTitle(
  apiKey: string,
  baseUrl: string,
  model: string,
  firstUserMessage: string,
  firstAgentReply: string | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!apiKey) return null;
  const url = `${baseUrl.replace(/\/$/, "")}/v1/messages`;

  const replyExcerpt = (firstAgentReply ?? "").slice(0, 600);
  const userExcerpt = firstUserMessage.slice(0, 600);

  try {
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 24,
        messages: [
          {
            role: "user",
            content:
              `Give a 2–5 word title (Title Case, no punctuation, no quotes) ` +
              `for a chat that starts with:\n\nUser: ${userExcerpt}` +
              (replyExcerpt ? `\nAssistant: ${replyExcerpt}` : "") +
              `\n\nReturn only the title.`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const raw = data.content?.find((b) => b.type === "text")?.text?.trim();
    if (!raw) return null;
    const cleaned = raw
      .replace(/^["'`]+|["'`.]+$/g, "")
      .replace(/\n.*$/s, "")
      .trim();
    return cleaned.length > 0 && cleaned.length <= 60 ? cleaned : null;
  } catch {
    return null;
  }
}
