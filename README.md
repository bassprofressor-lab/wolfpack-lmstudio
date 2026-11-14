# WolfPack LM Studio

**LM Studio Hub:** https://lmstudio.ai/krynexlabs/wolfpack-lmstudio — install with `lms get krynexlabs/wolfpack-lmstudio` or search "WolfPack" in the plugin browser.

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
  - `read_wolf_file(name)` — read the beginning of STATUS/cerebrum/memory/buglog/anatomy (default
    3000 characters; for anything further in, the model is pointed to `recall`)
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

## Private notes stay private

Anything wrapped in `<private>…</private>` in a `.wolf/` file is blanked before the plugin looks at
it — it cannot reach the injected digest, `recall` results, or `read_wolf_file`. This is the same
guarantee `OPENWOLF.md` gives, and the plugin reads the same files, so it keeps the same promise.

The rules:

- A **closed** block is hidden wherever it is, also inside code.
- An **unclosed** `<private>` at the start of a line (also after a list marker or `>`) hides
  everything from there to the end of the file. A forgotten closing tag must not silently mean
  "not private".
- An **inline** block hides only itself: `- deploy runs at 04:00 <private>token …</private>` stays
  findable by "deploy" with the token removed. An unclosed tag in the middle of a line hides the
  rest of that line.
- A **mention** of the syntax in inline code or a closed code fence (`` `<private>` ``) is text,
  not a block, and hides nothing. Before 0.3.0 such a mention hid the rest of the file, which in
  a real knowledge base removed most of `cerebrum.md` and every bug.
- In `buglog.json` every string value is filtered on its own, so the JSON stays readable.
- Notes written with `remember` cannot open a private block: tags in them are neutralised, and a
  note is one line of at most 1000 characters.

Filtering happens in the two functions that read knowledge files (one for text, one for JSON), so a
future feature that reads one is covered without having to remember this.

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

1. Open the plugin's **global** settings in LM Studio and set **Project root** to the absolute path
   of a project that has a `.wolf/` directory (created by
   [openwolf-enhanced](https://www.npmjs.com/package/openwolf-enhanced)). It applies to every chat.
2. Chat with your local model — the digest is injected into the first message of each chat, and the
   model can call `recall` / `remember`.

## Config

Global settings (set once, valid in every chat):

| Setting | Default | Meaning |
|---|---|---|
| Project root | (empty → env `OPENWOLF_PROJECT_DIR` → working dir) | Which project's `.wolf/` to use |
| Local model id | `qwen` | Write namespace under `.wolf/local/<id>/`; an id made only of dots falls back to `local` |
| Sync via OpenWolf MCP | off | On = recall + resume go through `openwolf mcp` (real BM25 + citations + native Auto Memory) |
| openwolf command | `openwolf` | How to invoke the OpenWolf CLI for MCP sync (or an absolute path) |

Per chat:

| Setting | Default | Meaning |
|---|---|---|
| Project root for this chat | empty = global value | Use a different project in this one chat |
| Auto-inject resume digest | on | Prepend the digest to the first message |
| Max digest size (chars) | 1500 | Keep small for small local models; quest, Do-Not-Repeat and bugs share it |
| Max size of read_wolf_file (chars) | 3000 | How much one `read_wolf_file` call returns. Several larger reads overflowed an 8k-context model in testing, and it began naming files that do not exist |

> **Upgrading from 0.2.0:** project root, model id and the MCP settings moved from the per-chat
> settings to the global ones. Set them once in the plugin settings; old per-chat values are not
> read any more.

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
