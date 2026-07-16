import { tool, type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { z } from "zod";
import { configSchematics, resolveProjectRoot } from "./config.js";
import { wolfDirFor, recall, remember, readWolfFile, hasWolf } from "./wolf.js";
import { openwolfMcpTool } from "./mcpClient.js";

// Tools the local model can call during a chat to work against the project's .wolf/ knowledge base:
// search it (recall), read a specific file, and jot a fact back (remember). This is the on-demand
// depth that complements the always-on digest injected by the prompt preprocessor.
export async function toolsProvider(ctl: ToolsProviderController): Promise<Tool[]> {
  function cfg(): { root: string; useMcp: boolean; openwolfCmd: string; agentId: string } {
    let projectRoot = "", useMcp = false, openwolfCmd = "openwolf", agentId = "qwen";
    try {
      const c = ctl.getPluginConfig(configSchematics);
      projectRoot = c.get("projectRoot");
      useMcp = c.get("useOpenwolfMcp");
      openwolfCmd = c.get("openwolfCommand");
      agentId = c.get("agentId") || "qwen";
    } catch {}
    let workingDir: string | undefined;
    try { workingDir = ctl.getWorkingDirectory?.(); } catch {}
    return { root: resolveProjectRoot(projectRoot, workingDir), useMcp, openwolfCmd, agentId };
  }

  const recallTool = tool({
    name: "recall",
    description:
      "Search the project's OpenWolf knowledge base (.wolf/: cerebrum, memory, STATUS, buglog) for facts, past decisions, conventions, and known bug fixes. Call this before re-deriving anything about the project.",
    parameters: { query: z.string().describe("Keywords to search for, e.g. 'redis retry backoff'") },
    implementation: async ({ query }) => {
      const { root: r, useMcp, openwolfCmd, agentId } = cfg();
      // Optional sync path: the real OpenWolf engine (BM25 + citations + native Auto Memory) over MCP.
      if (useMcp) {
        const viaMcp = await openwolfMcpTool(openwolfCmd, r, "openwolf_recall", { query, limit: 8 });
        if (viaMcp) return viaMcp;
        // fall through to local on any MCP failure — never leave the model empty-handed
      }
      if (!hasWolf(r)) return `No .wolf/ knowledge base found at ${r}. Set the plugin's Project root.`;
      const hits = recall(wolfDirFor(r), query, 8, agentId);
      if (hits.length === 0) return `No matches for "${query}".`;
      return hits.map((h) => `• [${h.file}:${h.line}] ${h.text}`).join("\n");
    },
  });

  const readTool = tool({
    name: "read_wolf_file",
    description:
      "Read one file from the project's .wolf/ knowledge base in full (bounded). Allowed: STATUS.md, cerebrum.md, memory.md, buglog.json, anatomy.md.",
    parameters: { name: z.string().describe("One of: STATUS.md, cerebrum.md, memory.md, buglog.json, anatomy.md") },
    implementation: async ({ name }) => {
      const { root: r } = cfg();
      if (!hasWolf(r)) return `No .wolf/ knowledge base found at ${r}.`;
      return readWolfFile(wolfDirFor(r), name);
    },
  });

  const rememberTool = tool({
    name: "remember",
    description:
      "Save a durable fact into YOUR OWN notes area (.wolf/local/<your-id>/memory.md) so future chats have it. This never modifies the project's canonical knowledge base — a reviewer promotes from your notes. Use for decisions, preferences, or gotchas worth keeping.",
    parameters: { fact: z.string().describe("The fact to remember, one concise sentence.") },
    implementation: async ({ fact }) => {
      const { root: r, agentId } = cfg();
      if (!hasWolf(r)) return `No .wolf/ knowledge base found at ${r}. Set the plugin's Project root.`;
      return remember(wolfDirFor(r), agentId, fact);
    },
  });

  return [recallTool, readTool, rememberTool];
}
