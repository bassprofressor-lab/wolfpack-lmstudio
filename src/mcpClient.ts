import { spawn } from "node:child_process";

// Minimal MCP client for OpenWolf's stdio server (`openwolf mcp`). That server speaks newline-
// delimited JSON-RPC 2.0 over stdin/stdout with tools openwolf_recall / openwolf_resume /
// openwolf_memory_health. We spawn it per call, do initialize → tools/call, read the text result,
// and shut it down. This is the OPTIONAL sync path: when enabled, WolfPack gets the real BM25
// recall + citations + native Auto Memory instead of the built-in light recall. Any failure returns
// null so the caller falls back to pure-local mode — the chat is never blocked.

export async function openwolfMcpTool(
  command: string,
  projectRoot: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, ["mcp", "--project", projectRoot], {
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, OPENWOLF_PROJECT_DIR: projectRoot },
      });
    } catch {
      resolve(null);
      return;
    }

    let done = false;
    let buf = "";
    const finish = (val: string | null) => {
      if (done) return;
      done = true;
      try { child.kill(); } catch {}
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    child.on("error", () => finish(null));

    const send = (obj: unknown) => {
      try { child.stdin.write(JSON.stringify(obj) + "\n"); } catch { finish(null); }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: { id?: number; result?: { content?: Array<{ text?: string }>; isError?: boolean } };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          // initialize acknowledged → issue the tool call
          send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } });
        } else if (msg.id === 2) {
          const text = msg.result?.content?.map((c) => c.text ?? "").join("\n") ?? null;
          finish(msg.result?.isError ? null : text);
        }
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "wolfpack-lmstudio", version: "0.1.0" } },
    });
  });
}
