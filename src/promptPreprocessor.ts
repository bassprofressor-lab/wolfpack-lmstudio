import type { PromptPreprocessorController, ChatMessage } from "@lmstudio/sdk";
import { configSchematics, resolveProjectRoot } from "./config.js";
import { buildDigest, wolfDirFor, hasWolf } from "./wolf.js";

// Fires when the user hits Send. Prepends a compact OpenWolf resume digest (current quest,
// Do-Not-Repeat, recently fixed bugs) so a local model continues with the project's hard-won
// context — the LM Studio analogue of OpenWolf's SessionStart additionalContext injection.
//
// It runs per-message (LM Studio has no session-start event), so the digest is deliberately small
// and the heavier lookups live in tools (recall / read_wolf_file) the model can call on demand.
export async function preprocess(
  ctl: PromptPreprocessorController,
  userMessage: ChatMessage,
): Promise<string | ChatMessage> {
  const userText = userMessage.getText();
  try {
    let projectRoot = "";
    let inject = true;
    let maxChars = 1500;
    try {
      const cfg = ctl.getPluginConfig(configSchematics);
      projectRoot = cfg.get("projectRoot");
      inject = cfg.get("injectDigest");
      maxChars = cfg.get("maxDigestChars");
    } catch {
      // Config not wired yet — fall back to env / working dir below.
    }

    let workingDir: string | undefined;
    try { workingDir = ctl.getWorkingDirectory?.(); } catch {}
    const root = resolveProjectRoot(projectRoot, workingDir);

    if (!inject || !hasWolf(root)) return userText;

    const digest = buildDigest(wolfDirFor(root), maxChars);
    if (!digest) return userText;

    return [
      "<wolfpack-context>",
      "Project knowledge (from .wolf/). Use it; call the `recall` tool to search deeper before re-deriving anything.",
      "",
      digest,
      "</wolfpack-context>",
      "",
      userText,
    ].join("\n");
  } catch {
    // Never block the user's message on a preprocessing failure.
    return userText;
  }
}
