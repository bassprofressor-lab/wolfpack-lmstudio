# WolfPack LM Studio

Bring your project's **`.wolf/` knowledge base** into every LM Studio chat. Local-only — no cloud,
no MCP. Built for people who run a local model (e.g. Qwen) in LM Studio and want it to remember the
project the way [OpenWolf](https://github.com/bassprofressor-lab/openwolf-enhanced) makes Claude Code
remember it.

## What it does

- **Auto-injects a resume digest** on every message (prompt preprocessor): the current quest from
  `STATUS.md`, the `Do-Not-Repeat` list from `cerebrum.md`, and recently fixed bugs from
  `buglog.json` — so the model continues with the project's hard-won context. Bounded (default
  1500 chars) so it stays cheap on a small local model.
- **Gives the model tools** (tools provider):
  - `recall(query)` — keyword search across `.wolf/` (cerebrum, memory, STATUS, buglog)
  - `read_wolf_file(name)` — read STATUS/cerebrum/memory/buglog/anatomy in full (bounded)
  - `remember(fact)` — save a durable fact to `.wolf/memory.md`

## Two modes

- **Pure local (default).** Reads the `.wolf/` directory directly — digest + a built-in keyword
  recall. No dependency, no network, no MCP. Everything stays on your machine.
- **OpenWolf MCP sync (optional toggle).** Routes `recall` and the resume digest through the
  OpenWolf MCP server (`openwolf mcp`), giving you the **real BM25 recall with citation ids, plus
  Claude's native Auto Memory** — the same engine Claude Code uses. Requires the `openwolf` CLI on
  the machine. If it's unavailable, WolfPack silently falls back to pure-local, so the chat never
  breaks.

Same `.wolf/` either way — it's one shared knowledge base, not a separate store.

## Write isolation (read union, write per-agent)

A local model **reads** everything (canonical `.wolf/` + its own notes) but **writes only to its own
area**: `.wolf/local/<agentId>/memory.md`. It never modifies `STATUS.md`, `cerebrum.md`, `memory.md`,
or `buglog.json` — the authoritative knowledge base maintained by openwolf / Claude Code. Give each
model a distinct `agentId` (default `qwen`) and their notes stay separate. A stronger model (or you)
can then read `.wolf/local/*/` to see what each local model did, evaluate it, correct it, and promote
what's worth keeping into the canonical files — without a local model ever overwriting them. Same
"propose, never overwrite" rule the OpenWolf AI tasks follow.

## What it does NOT do (and why)

OpenWolf's Claude Code integration passively watches file reads/edits and maintains anatomy, a token
ledger, and memory automatically. LM Studio is a **chat**, not a coding agent — there are no
file-operation events to observe. So the automatic, zero-effort capture stays exclusive to the
Claude Code / Codex hooks; here you get the context-injection + recall + memory core.

## Install

### From GitHub (this repo)

```bash
git clone https://github.com/bassprofressor-lab/wolfpack-lmstudio.git
cd wolfpack-lmstudio
npm install
lms dev          # loads the plugin into a running LM Studio with hot reload
```

`lms` is the LM Studio CLI (bundled with LM Studio; run `lms bootstrap` once if `lms` isn't on your
PATH). `lms dev` registers the plugin with your local LM Studio instance directly from this folder —
no Hub account needed.

### From the LM Studio Hub (once published)

Search **WolfPack** in LM Studio's plugin browser, or `lms get krynexlabs/wolfpack-lmstudio`.

## Setup

1. Open the plugin's config in LM Studio and set **Project root** to the absolute path of a project
   that has a `.wolf/` directory (created by
   [openwolf-enhanced](https://www.npmjs.com/package/openwolf-enhanced)).
2. Chat with your local model — the digest is injected automatically, and the model can call
   `recall` / `remember`.

## Config

| Setting | Default | Meaning |
|---|---|---|
| Project root | (empty → env `OPENWOLF_PROJECT_DIR` → working dir) | Which project's `.wolf/` to use |
| Auto-inject resume digest | on | Prepend the digest to each message |
| Max digest size (chars) | 1500 | Keep small for small local models |
| Sync via OpenWolf MCP | off | On = recall + resume go through `openwolf mcp` (real BM25 + citations + native Auto Memory) |
| openwolf command | `openwolf` | How to invoke the OpenWolf CLI for MCP sync (or an absolute path) |

## Develop & publish

```bash
npm install
npm run build     # tsc typecheck
lms dev           # load into LM Studio with hot reload
lms login         # once, to link your Hub account
lms push          # publish to the LM Studio Hub → lmstudio.ai/krynexlabs/wolfpack-lmstudio
```

Published by **krynexlabs** (`owner` in `manifest.json`).

AGPL-3.0. Companion to [openwolf-enhanced](https://github.com/bassprofressor-lab/openwolf-enhanced).
