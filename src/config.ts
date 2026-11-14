import { createConfigSchematics } from "@lmstudio/sdk";

// Two levels of settings, because LM Studio has two:
//   • global (withGlobalConfigSchematics) — set once in the plugin settings, valid in every chat.
//     Which project, which write namespace, and which program to start for MCP sync live here.
//     The program in particular must not be a per-chat value: it is something the plugin executes.
//   • per chat (withConfigSchematics) — a different project for this one chat, and how much digest
//     this chat gets.
// Until 0.2.0 everything was per chat although the comments said "global", so the project root had
// to be set again in every new chat.

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "projectRoot",
    "string",
    {
      displayName: "Project root",
      subtitle: "Absolute path to the project whose .wolf/ knowledge base to use (contains STATUS.md, cerebrum.md, memory.md, buglog.json). Applies to every chat unless a chat sets its own.",
    },
    "",
  )
  .field(
    "agentId",
    "string",
    {
      displayName: "Local model id (write namespace)",
      subtitle: "This model's own area under .wolf/local/<id>/. All writes go here — the canonical .wolf/ files are never touched. Use a distinct id per model (e.g. 'qwen', 'llama').",
    },
    "qwen",
  )
  .field(
    "useOpenwolfMcp",
    "boolean",
    {
      displayName: "Sync via OpenWolf MCP (optional)",
      subtitle: "Off = pure local (reads .wolf/ directly). On = route recall + resume through the OpenWolf MCP server for real BM25 recall, citations, and native Auto Memory. Requires the openwolf CLI.",
    },
    false,
  )
  .field(
    "openwolfCommand",
    "string",
    {
      displayName: "openwolf command",
      subtitle: "How to invoke the OpenWolf CLI for MCP sync (e.g. 'openwolf', or an absolute path to the bin). Only used when MCP sync is on.",
    },
    "openwolf",
  )
  .build();

export const configSchematics = createConfigSchematics()
  .field(
    "projectRootOverride",
    "string",
    {
      displayName: "Project root for this chat",
      subtitle: "Leave empty to use the global project root from the plugin settings.",
    },
    "",
  )
  .field(
    "injectDigest",
    "boolean",
    {
      displayName: "Auto-inject resume digest",
      subtitle: "Prepend the current quest + Do-Not-Repeat + known bugs to the first message of a chat.",
    },
    true,
  )
  .field(
    "maxDigestChars",
    "numeric",
    {
      displayName: "Max digest size (chars)",
      subtitle: "Keep small for small local models so context stays cheap.",
      min: 300,
      max: 6000,
    },
    1500,
  )
  .field(
    "maxReadChars",
    "numeric",
    {
      displayName: "Max size of read_wolf_file (chars)",
      subtitle: "How much one read_wolf_file call returns. Several full reads overflow a small local model's context and it starts inventing; 3000 suits 8k-context models.",
      min: 1000,
      max: 20000,
    },
    3000,
  )
  .build();

export interface Settings {
  /** The configured project root, chat value first, then global; "" when neither is set. */
  projectRoot: string;
  agentId: string;
  useMcp: boolean;
  openwolfCmd: string;
  injectDigest: boolean;
  maxDigestChars: number;
  maxReadChars: number;
}

/** Anything that can hand out both configs — the preprocessor and the tools provider controllers. */
interface ConfigSource {
  getPluginConfig: (s: typeof configSchematics) => { get: (k: never) => unknown };
  getGlobalPluginConfig?: (s: typeof globalConfigSchematics) => { get: (k: never) => unknown };
}

/**
 * Read both levels. Each read is best-effort: a controller without config (older runtime, tests)
 * leaves the defaults in place instead of failing the chat.
 */
export function readSettings(ctl: unknown): Settings {
  const src = ctl as ConfigSource;
  const s: Settings = { projectRoot: "", agentId: "qwen", useMcp: false, openwolfCmd: "openwolf", injectDigest: true, maxDigestChars: 1500, maxReadChars: 3000 };
  let globalRoot = "";
  try {
    const g = src.getGlobalPluginConfig?.(globalConfigSchematics) as unknown as { get(k: string): unknown } | undefined;
    if (g) {
      globalRoot = String(g.get("projectRoot") ?? "");
      s.agentId = String(g.get("agentId") ?? "") || "qwen";
      s.useMcp = Boolean(g.get("useOpenwolfMcp"));
      s.openwolfCmd = String(g.get("openwolfCommand") ?? "") || "openwolf";
    }
  } catch { /* defaults */ }
  let chatRoot = "";
  try {
    const c = src.getPluginConfig(configSchematics) as unknown as { get(k: string): unknown };
    chatRoot = String(c.get("projectRootOverride") ?? "");
    s.injectDigest = Boolean(c.get("injectDigest"));
    const n = Number(c.get("maxDigestChars"));
    if (Number.isFinite(n) && n > 0) s.maxDigestChars = n;
    const r = Number(c.get("maxReadChars"));
    if (Number.isFinite(r) && r > 0) s.maxReadChars = r;
  } catch { /* defaults */ }
  s.projectRoot = chatRoot.trim() || globalRoot.trim();
  return s;
}

/**
 * Resolve the project root defensively: configured value first, then env, then the chat's working
 * directory. Keeps the plugin useful even before the user sets the path.
 */
export function resolveProjectRoot(configured: string | undefined, workingDir: string | undefined): string {
  const candidate = (configured && configured.trim()) || process.env.OPENWOLF_PROJECT_DIR || workingDir || process.cwd();
  return candidate;
}
