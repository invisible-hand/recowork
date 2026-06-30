/**
 * One-shot title generator. Calls the Rust `generate_title` command which
 * proxies the request to Baseten's Anthropic-compatible /v1/messages.
 *
 * The webview's `fetch` can't talk to Baseten directly — Baseten's API
 * doesn't return Access-Control-Allow-Origin headers and the
 * `anthropic-version` custom header triggers a CORS preflight that fails
 * with no recoverable error in the webview. Running the request through
 * Rust bypasses CORS entirely.
 */
import { invoke } from "@tauri-apps/api/core";

export async function generateTitle(
  apiKey: string,
  baseUrl: string,
  model: string,
  firstUserMessage: string,
  firstAgentReply: string | undefined,
): Promise<string | null> {
  if (!apiKey) return null;
  try {
    const title = await invoke<string | null>("generate_title", {
      apiKey,
      baseUrl,
      model,
      userMessage: firstUserMessage,
      agentReply: firstAgentReply ?? null,
    });
    return title ?? null;
  } catch (err) {
    // Rust returned Err(...) — surface in the caller's diagnostic logs.
    throw new Error(String(err));
  }
}
