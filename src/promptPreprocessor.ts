import type { PromptPreprocessorController, ChatMessage } from "@lmstudio/sdk";
import { configSchematics, resolveProjectRoot } from "./config.js";
import { buildDigest, wolfDirFor, hasWolf } from "./wolf.js";
import { openwolfMcpTool } from "./mcpClient.js";

/** Marker that identifies an already-injected digest in the chat history. */
export const CONTEXT_TAG = "<wolfpack-context>";

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
    let useMcp = false;
    let openwolfCmd = "openwolf";
    try {
      const cfg = ctl.getPluginConfig(configSchematics);
      projectRoot = cfg.get("projectRoot");
      inject = cfg.get("injectDigest");
      maxChars = cfg.get("maxDigestChars");
      useMcp = cfg.get("useOpenwolfMcp");
      openwolfCmd = cfg.get("openwolfCommand");
    } catch {
      // Config not wired yet — fall back to env / working dir below.
    }

    let workingDir: string | undefined;
    try { workingDir = ctl.getWorkingDirectory?.(); } catch {}
    const root = resolveProjectRoot(projectRoot, workingDir);

    if (!inject) return userText;

    // Inject once per chat, not once per message. The digest is ~1.500 characters; a twenty-turn
    // chat used to carry twenty copies of it, which on an 8k local model is most of the window spent
    // repeating what the model already read. If the marker is anywhere in the history, this chat has
    // it. pullHistory is best-effort: if it is unavailable or throws, fall back to injecting, since
    // a duplicated digest is a smaller problem than a missing one.
    try {
      const history = await ctl.pullHistory?.();
      if (history && history.toString().includes(CONTEXT_TAG)) return userText;
    } catch { /* fall through and inject */ }

    // Optional sync: pull the real OpenWolf resume digest over MCP (staleness-aware, native memory).
    let digest = "";
    if (useMcp) {
      const viaMcp = await openwolfMcpTool(openwolfCmd, root, "openwolf_resume", {});
      if (viaMcp) digest = viaMcp.slice(0, maxChars);
    }
    // Pure-local default (also the fallback if MCP returned nothing).
    if (!digest) {
      if (!hasWolf(root)) return userText;
      digest = buildDigest(wolfDirFor(root), maxChars);
    }
    if (!digest) return userText;

    return [
      CONTEXT_TAG,
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
