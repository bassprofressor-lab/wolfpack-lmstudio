// Regression tests for the review of 14.11.2026. Each one failed against 0.2.0.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildDigest, recall, readWolfFile, remember, readBugs, blankPrivate, localDir, safeAgentId, MAX_FACT_CHARS } from "../dist/wolf.js";
import { readSettings } from "../dist/config.js";

function makeWolf(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-test-"));
  const wolf = path.join(dir, ".wolf");
  fs.mkdirSync(wolf, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(wolf, name), content, "utf-8");
  return { dir, wolf, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const SECRET = "hunter2-STAGING-PASSWORD";

// ── Bug 1: a mention of the tag must not hide the rest of the file ───────────────────────────────

test("a <private> mention in inline code hides nothing", () => {
  const t = "- the plugin did not know `<private>` yet\n- later line about kafka\n";
  assert.equal(blankPrivate(t), t);
});

test("a <private> mention inside a closed code fence hides nothing", () => {
  const t = "```\nconst RE = /<private>/;\n```\nafter the fence: kafka\n";
  assert.equal(blankPrivate(t), t);
});

test("a mid-line mention in prose hides only the rest of its own line", () => {
  const out = blankPrivate("raw <private>-blocks in the dashboard were prose\nnext line survives\n");
  assert.match(out, /^raw \n/);
  assert.match(out, /next line survives/);
});

test("a closed pair inside inline code is still blanked", () => {
  const out = blankPrivate(`token: \`<private>${SECRET}</private>\` end`);
  assert.ok(!out.includes(SECRET));
  assert.match(out, /end$/);
});

test("a mention in code does not pair with a later real block and swallow the text between", () => {
  const out = blankPrivate(`doc: \`<private>\` syntax\nkeep this line\n<private>${SECRET}</private>\nand this one\n`);
  assert.match(out, /keep this line/);
  assert.match(out, /and this one/);
  assert.ok(!out.includes(SECRET));
});

test("an unclosed block opener at line start still hides everything after it (fail closed)", () => {
  for (const prefix of ["", "- ", "  * ", "> ", "3. "]) {
    const out = blankPrivate(`top\n${prefix}<private>no end\n${SECRET}\nmore\n`);
    assert.ok(!out.includes(SECRET), `leaked with prefix ${JSON.stringify(prefix)}`);
    assert.ok(!out.includes("more"));
  }
});

test("an unclosed code fence does not turn a real private block into code", () => {
  const out = blankPrivate(`\`\`\`\nopen fence never closed\n<private>${SECRET}</private>\n`);
  assert.ok(!out.includes(SECRET));
});

test("an unclosed backtick does not turn a real private block into code", () => {
  const out = blankPrivate(`a stray \` backtick <private>${SECRET}</private> ok\n`);
  assert.ok(!out.includes(SECRET));
});

test("line count is kept by every rule", () => {
  const t = "a\n- `<private>` b\n<private>x\ny</private>\nmid <private>z\nlast\n<private>open\nrest\n";
  assert.equal(blankPrivate(t).split("\n").length, t.split("\n").length);
});

test("the buglog stays readable when an entry mentions the tag", () => {
  const { wolf, cleanup } = makeWolf({
    "buglog.json": JSON.stringify({ bugs: [
      { id: "bug-1", error_message: "plugin passed <private>-blocks to the model", fix: "blank them", tags: ["gefixt"] },
      { id: "bug-2", error_message: "kafka lag", fix: `rotated <private>${SECRET}</private> key`, tags: ["gefixt"] },
      { id: "bug-3", error_message: "still broken thing", fix: "", tags: ["offen"] },
    ] }, null, 2),
  });
  const bugs = readBugs(wolf);
  assert.equal(bugs.length, 3, "all entries must survive");
  assert.equal(bugs[0].error_message, "plugin passed ", "a mention costs the rest of that field only");
  const all = JSON.stringify(bugs) + readWolfFile(wolf, "buglog.json") + buildDigest(wolf, 3000);
  assert.ok(!all.includes(SECRET), "private value leaked");
  assert.match(buildDigest(wolf, 3000), /STILL OPEN.*still broken thing/);
  cleanup();
});

test("the digest carries Do-Not-Repeat even when cerebrum mentions the tag earlier", () => {
  const { wolf, cleanup } = makeWolf({
    "STATUS.md": "# S\n\n## 🚀 Next\n- ship v2\n",
    "cerebrum.md": "# C\n\n## Lessons\n- the old filter did not know `<private>`\n\n## Do-Not-Repeat\n- never copy config.py to S2\n",
  });
  const d = buildDigest(wolf, 1500);
  assert.match(d, /never copy config\.py to S2/);
  assert.match(recall(wolf, "config.py", 5)[0]?.text ?? "", /never copy config\.py/);
  cleanup();
});

// ── Bug 2: an agent id made of dots must not reach the canonical files ───────────────────────────

test("agent ids '.' and '..' stay inside .wolf/local", () => {
  const { wolf, cleanup } = makeWolf({ "memory.md": "# canonical\n" });
  for (const id of [".", "..", "...", "", "/", "../.."]) {
    const d = localDir(wolf, id);
    assert.ok(d.startsWith(path.join(wolf, "local") + path.sep), `${JSON.stringify(id)} -> ${d}`);
  }
  assert.equal(safeAgentId(".."), "local");
  remember(wolf, "..", "probe");
  assert.equal(fs.readFileSync(path.join(wolf, "memory.md"), "utf-8"), "# canonical\n", "canonical memory.md was written");
  cleanup();
});

test("the confirmation names the directory that was really written", () => {
  const { wolf, cleanup } = makeWolf({});
  assert.match(remember(wolf, "a b", "x"), /local\/a_b\/memory\.md/);
  cleanup();
});

// ── Bug 3: what the model writes cannot hide later notes, and is bounded ─────────────────────────

test("a remembered fact with a private tag does not hide later notes", () => {
  const { wolf, cleanup } = makeWolf({});
  remember(wolf, "qwen", "note <private> never closed");
  remember(wolf, "qwen", "second note about kafka");
  assert.equal(recall(wolf, "kafka", 5, "qwen").length, 1, "later note was hidden");
  cleanup();
});

test("remember bounds the fact and keeps it on one line", () => {
  const { wolf, cleanup } = makeWolf({});
  remember(wolf, "qwen", "a\r\nb\rc\n" + "x".repeat(5000));
  const own = fs.readFileSync(path.join(wolf, "local", "qwen", "memory.md"), "utf-8");
  const last = own.trim().split("\n").pop();
  assert.ok(last.length <= MAX_FACT_CHARS + 30, `note not bounded: ${last.length}`);
  assert.match(last, /a b c x/);
  assert.match(remember(wolf, "qwen", "  \n "), /Not saved/);
  cleanup();
});

// ── Bug 4: global settings, with a per-chat override ─────────────────────────────────────────────

function fakeCtl(globalVals, chatVals) {
  const mk = (vals) => ({ get: (k) => vals[k] });
  return {
    getGlobalPluginConfig: globalVals ? () => mk(globalVals) : undefined,
    getPluginConfig: chatVals ? () => mk(chatVals) : () => { throw new Error("no config"); },
  };
}

test("the project root comes from the global settings", () => {
  const s = readSettings(fakeCtl({ projectRoot: "/proj", agentId: "llama", useOpenwolfMcp: false, openwolfCommand: "" },
                                 { projectRootOverride: "", injectDigest: true, maxDigestChars: 1500 }));
  assert.equal(s.projectRoot, "/proj");
  assert.equal(s.agentId, "llama");
  assert.equal(s.openwolfCmd, "openwolf");
});

test("a chat can override the global project root", () => {
  const s = readSettings(fakeCtl({ projectRoot: "/proj" }, { projectRootOverride: " /other ", injectDigest: false, maxDigestChars: 800 }));
  assert.equal(s.projectRoot, "/other");
  assert.equal(s.injectDigest, false);
  assert.equal(s.maxDigestChars, 800);
});

test("settings fall back to defaults when the runtime gives no config", () => {
  const s = readSettings(fakeCtl(undefined, undefined));
  assert.deepEqual(s, { projectRoot: "", agentId: "qwen", useMcp: false, openwolfCmd: "openwolf", injectDigest: true, maxDigestChars: 1500, maxReadChars: 3000 });
});

test("with the default budget the digest still carries lessons and bugs next to a long quest", () => {
  const { wolf, cleanup } = makeWolf({
    "STATUS.md": "# S\n\n## 🚀 Next\n" + "- a long quest line about the current work\n".repeat(40),
    "cerebrum.md": "# C\n\n## Do-Not-Repeat\n" + Array.from({ length: 10 }, (_, i) => `- lesson ${i}: ` + "detail ".repeat(25)).join("\n") + "\n",
    "buglog.json": JSON.stringify({ bugs: [{ id: "b1", error_message: "kafka lag", fix: "", tags: ["offen"] }] }),
  });
  const d = buildDigest(wolf, 1500);
  assert.ok(d.length <= 1500, `over budget: ${d.length}`);
  assert.match(d, /## Do-Not-Repeat\n[\s\S]*- lesson 9:/, "newest lesson must be there");
  assert.match(d, /STILL OPEN\] kafka lag/);
  cleanup();
});

// ── Live test 14.11.: three 8k reads overflowed qwen3.8's 8k window and it invented file names ──

test("read_wolf_file returns at most 3000 characters by default and points to recall", () => {
  const { wolf, cleanup } = makeWolf({ "cerebrum.md": "- lesson line about kafka\n".repeat(2000) });
  const out = readWolfFile(wolf, "cerebrum.md");
  assert.ok(out.length <= 3200, `not bounded: ${out.length}`);
  assert.match(out, /truncated at 3000 of \d+ chars — use recall/);
  cleanup();
});

test("the read size comes from the chat settings", () => {
  assert.equal(readSettings(fakeCtl(undefined, { maxReadChars: 6000 })).maxReadChars, 6000);
  assert.equal(readSettings(fakeCtl(undefined, undefined)).maxReadChars, 3000);
});
