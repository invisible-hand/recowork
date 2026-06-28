/**
 * Baseten pricing for GLM-5.2 (per the project spec). We compute cost
 * client-side because the SDK's `total_cost_usd` is Anthropic's price for
 * Claude, which doesn't apply to GLM via Baseten.
 *
 * Keep in sync with https://www.baseten.co/library/glm-52/ — these
 * numbers were confirmed mid-2026 and Baseten reserves the right to change
 * them. The model selector key is the model id string from settings.
 */
export interface ModelPrice {
  /** USD per input token */
  input: number;
  /** USD per cached input token */
  cachedInput: number;
  /** USD per output token */
  output: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "zai-org/GLM-5.2": {
    input:       1.40 / 1_000_000,
    cachedInput: 0.26 / 1_000_000,
    output:      4.40 / 1_000_000,
  },
};

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function computeCost(model: string, usage: Usage | undefined): number {
  if (!usage) return 0;
  const p = MODEL_PRICES[model];
  if (!p) return 0;
  const cachedRead = usage.cache_read_input_tokens ?? 0;
  const freshInput = (usage.input_tokens ?? 0) - cachedRead;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  return (
    Math.max(0, freshInput) * p.input +
    cachedRead * p.cachedInput +
    cacheCreate * p.input +
    output * p.output
  );
}

export function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return (n / 1_000_000).toFixed(2) + "M";
}

export function formatUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
