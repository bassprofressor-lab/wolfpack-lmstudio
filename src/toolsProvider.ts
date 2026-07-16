import { tool, type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { z } from "zod";
import { configSchematics, resolveProjectRoot } from "./config.js";
import { wolfDirFor, recall, remember, readWolfFile, hasWolf } from "./wolf.js";

// Tools the local model can call during a chat to work against the project's .wolf/ knowledge base:
// search it (recall), read a specific file, and jot a fact back (remember). This is the on-demand
// depth that complements the always-on digest injected by the prompt preprocessor.
export async function toolsProvider(ctl: ToolsProviderController): Promise<Tool[]> {
  function root(): string {
    let projectRoot = "";
    try { projectRoot = ctl.getPluginConfig(configSchematics).get("projectRoot"); } catch {}
    let workingDir: string | undefined;
    try { workingDir = ctl.getWorkingDirectory?.(); } catch {}
    return resolveProjectRoot(projectRoot, workingDir);
  }

  const recallTool = tool({
    name: "recall",
    description:
      "Search the project's OpenWolf knowledge base (.wolf/: cerebrum, memory, STATUS, buglog) for facts, past decisions, conventions, and known bug fixes. Call this before re-deriving anything about the project.",
    parameters: { query: z.string().describe("Keywords to search for, e.g. 'redis retry backoff'") },
    implementation: async ({ query }) => {
      const r = root();
      if (!hasWolf(r)) return `No .wolf/ knowledge base found at ${r}. Set the plugin's Project root.`;
      const hits = recall(wolfDirFor(r), query, 8);
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
      const r = root();
      if (!hasWolf(r)) return `No .wolf/ knowledge base found at ${r}.`;
      return readWolfFile(wolfDirFor(r), name);
    },
  });

  const rememberTool = tool({
    name: "remember",
    description:
      "Save a durable fact to the project's memory (.wolf/memory.md) so future chats have it. Use for decisions, preferences, or gotchas worth keeping.",
    parameters: { fact: z.string().describe("The fact to remember, one concise sentence.") },
    implementation: async ({ fact }) => {
      const r = root();
      if (!hasWolf(r)) return `No .wolf/ knowledge base found at ${r}. Set the plugin's Project root.`;
      return remember(wolfDirFor(r), fact);
    },
  });

  return [recallTool, readTool, rememberTool];
}
