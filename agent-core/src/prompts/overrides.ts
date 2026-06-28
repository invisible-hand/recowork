/**
 * GLM-5.2 prompt calibration.
 *
 * The Claude Agent SDK's defaults are tuned for Claude. GLM-5.2 may over- or
 * under-call tools, fail to stop, or hallucinate tool args. All overrides
 * live here so the calibration is in one place.
 *
 * Update this file based on Phase 1 fixture observations.
 */

export const GLM_SYSTEM_APPEND = `
You are running on GLM-5.2 served via Baseten through a Claude-tuned harness.
Operating rules:
- Never invent tool names or argument schemas. Use exactly the tools provided.
- After a tool returns, read the result carefully before deciding the next step.
- When you believe the task is complete, stop. Do not keep calling tools to
  "double-check" — return a final summary instead.
- Tool arguments must be valid JSON matching the declared schema. No trailing
  commas, no comments, no unquoted keys.
- If a tool call fails, surface the failure plainly. Do not retry the same call
  unchanged; either fix the arguments or try a different approach.
`.trim();

export const STOP_HINT =
  "When the user's goal has been met, end your turn with a concise summary " +
  "(≤5 lines) and stop. Do not request additional tool calls after the summary.";

/**
 * Returns the string to pass as `systemPrompt.append` on the
 * `{ type: 'preset', preset: 'claude_code', append }` Options field.
 * This preserves the SDK's built-in Claude Code system prompt and layers
 * GLM-specific calibration on top of it.
 */
export function buildSystemAppend(userSystemPrompt?: string): string {
  const parts = [GLM_SYSTEM_APPEND, STOP_HINT];
  if (userSystemPrompt && userSystemPrompt.trim() !== "") {
    parts.push(userSystemPrompt.trim());
  }
  return parts.join("\n\n");
}
