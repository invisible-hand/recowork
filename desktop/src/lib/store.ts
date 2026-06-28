import { LazyStore } from "@tauri-apps/plugin-store";

export type ApprovalMode = "always" | "auto" | "writes_only";

export type ThemeName =
  | "linen"
  | "sage"
  | "lavender"
  | "coral"
  | "slate"
  | "blossom"
  | "midnight";

export interface AppSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxOutputTokens: number;
  provider: "baseten-anthropic" | "baseten-openai-via-litellm";
  workspaceDir: string;
  approvalMode: ApprovalMode;
  mcpFilesystemEnabled: boolean;
  sandboxEnabled: boolean;
  sandboxImage: string;
  theme: ThemeName;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: "",
  baseUrl: "https://inference.baseten.co",
  model: "zai-org/GLM-5.2",
  maxOutputTokens: 8192,
  provider: "baseten-anthropic",
  workspaceDir: "",
  approvalMode: "writes_only",
  mcpFilesystemEnabled: true,
  sandboxEnabled: false,
  sandboxImage: "recowork-agent:latest",
  theme: "linen",
};

const STORE_PATH = "settings.json";

let store: LazyStore | null = null;

function getStore(): LazyStore {
  if (!store) store = new LazyStore(STORE_PATH);
  return store;
}

export async function loadSettings(): Promise<AppSettings> {
  const s = getStore();
  const result: AppSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
    const v = await s.get(key);
    if (v !== undefined && v !== null) {
      // @ts-expect-error — runtime-checked via key
      result[key] = v;
    }
  }
  return result;
}

export async function saveSettings(s: AppSettings): Promise<void> {
  const store = getStore();
  for (const [k, v] of Object.entries(s)) {
    await store.set(k, v);
  }
  await store.save();
}
