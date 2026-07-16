import { createConfigSchematics } from "@lmstudio/sdk";

// Global plugin settings (shown in LM Studio's plugin config UI). LM Studio chats aren't bound to a
// project directory, so the user points the plugin at the project whose .wolf/ they want surfaced.
export const configSchematics = createConfigSchematics()
  .field(
    "projectRoot",
    "string",
    {
      displayName: "Project root",
      subtitle: "Absolute path to the project whose .wolf/ knowledge base to use (contains STATUS.md, cerebrum.md, memory.md, buglog.json).",
    },
    "",
  )
  .field(
    "injectDigest",
    "boolean",
    {
      displayName: "Auto-inject resume digest",
      subtitle: "Prepend the current quest + Do-Not-Repeat + known bugs to each message.",
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
  .build();

/**
 * Resolve the project root defensively: configured value first, then env, then the chat's working
 * directory. Keeps the plugin useful even before the user sets the path.
 */
export function resolveProjectRoot(configured: string | undefined, workingDir: string | undefined): string {
  const candidate = (configured && configured.trim()) || process.env.OPENWOLF_PROJECT_DIR || workingDir || process.cwd();
  return candidate;
}
