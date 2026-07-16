import type { PluginContext } from "@lmstudio/sdk";
import { configSchematics } from "./config.js";
import { preprocess } from "./promptPreprocessor.js";
import { toolsProvider } from "./toolsProvider.js";

// OpenWolf context layer for LM Studio.
//
// Two hooks give a local model the same kind of project memory OpenWolf gives Claude Code:
//   • prompt preprocessor — injects a compact resume digest from .wolf/ into each message
//   • tools provider       — recall / read_wolf_file / remember, for on-demand depth
//
// No cloud, no MCP: it reads the project's .wolf/ directory directly.
//
// LM Studio's plugin runner invokes the exported `main(context)`. `register` is kept as an alias
// for older SDKs.
export async function main(context: PluginContext): Promise<void> {
  context.withConfigSchematics(configSchematics);
  context.withPromptPreprocessor(preprocess);
  context.withToolsProvider(toolsProvider);
}

export const register = main;
