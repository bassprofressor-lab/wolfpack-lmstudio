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

Search **WolfPack** in LM Studio's plugin browser, or `lms get <owner>/wolfpack-lmstudio`.

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

## Develop & publish

```bash
npm install
npm run build     # tsc typecheck
lms dev           # load into LM Studio with hot reload
lms login         # once, to link your Hub account
lms push          # publish to the LM Studio Hub → lmstudio.ai/<your-handle>/wolfpack-lmstudio
```

Set `owner` in `manifest.json` to your LM Studio handle before publishing.

AGPL-3.0. Companion to [openwolf-enhanced](https://github.com/bassprofressor-lab/openwolf-enhanced).
