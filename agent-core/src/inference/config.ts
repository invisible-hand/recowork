import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// dotenv prints a "tip" line to stdout by default, which corrupts the JSON
// Lines stream the sidecar writes to its host. Pass quiet: true to silence
// it. Loading is still best-effort — when the host provides config via a
// config message we don't need a file at all.
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadDotenv({ path: envPath, quiet: true });
else loadDotenv({ quiet: true });

export type ProviderId =
  | "baseten-anthropic"
  | "baseten-openai-via-litellm";

export interface InferenceConfig {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  maxOutputTokens: number;
  /**
   * Env vars passed to the SDK's spawned subprocess. The SDK reads
   * ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN; ANTHROPIC_AUTH_TOKEN switches
   * the SDK to "Authorization: Bearer …" which is what Baseten expects.
   */
  sdkEnv: Record<string, string>;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required env var ${name}. Copy agent-core/.env.example to .env and fill it in.`,
    );
  }
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

export function loadConfig(): InferenceConfig {
  const provider = optional(
    "INFERENCE_PROVIDER",
    "baseten-anthropic",
  ) as ProviderId;
  const apiKey = required("BASETEN_API_KEY");
  const model = optional("INFERENCE_MODEL", "zai-org/GLM-5.2");
  const maxOutputTokens = Number(optional("MAX_OUTPUT_TOKENS", "8192"));

  let baseUrl: string;
  switch (provider) {
    case "baseten-anthropic":
      baseUrl = optional(
        "INFERENCE_BASE_URL",
        "https://inference.baseten.co",
      );
      break;
    case "baseten-openai-via-litellm":
      baseUrl = optional("LITELLM_PROXY_URL", "http://127.0.0.1:4000");
      break;
    default:
      throw new Error(`Unknown INFERENCE_PROVIDER: ${provider}`);
  }

  return {
    provider,
    baseUrl,
    model,
    apiKey,
    maxOutputTokens,
    sdkEnv: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_DEFAULT_MODEL: model,
      ANTHROPIC_MAX_OUTPUT_TOKENS: String(maxOutputTokens),
    },
  };
}

export function describeConfig(cfg: InferenceConfig): string {
  return [
    `provider:   ${cfg.provider}`,
    `baseUrl:    ${cfg.baseUrl}`,
    `model:      ${cfg.model}`,
    `maxOutput:  ${cfg.maxOutputTokens}`,
    `apiKey:     ${cfg.apiKey.slice(0, 4)}…${cfg.apiKey.slice(-4)}`,
  ].join("\n");
}
