import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildDigest, recall, readWolfFile, remember, isOpenBug, blankPrivate } from "../dist/wolf.js";

/** A throwaway .wolf/ so the tests never depend on (or touch) a real project. */
function makeWolf(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-test-"));
  const wolf = path.join(dir, ".wolf");
  fs.mkdirSync(wolf, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(wolf, name), content, "utf-8");
  }
  return { dir, wolf, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const SECRET = "hunter2-STAGING-PASSWORD";

// OPENWOLF.md promises that <private> content stays out of the resume context and out of recall.
// The plugin reads the same files, so it owes the same promise — and did not keep it: the digest,
// recall and read_wolf_file all handed private blocks to the model. These three tests are the
// promise, written down.
test("the digest never carries a <private> block", () => {
  const { wolf, cleanup } = makeWolf({
    "STATUS.md": `# STATUS\n\n## 🚀 Quest\n- ship it\n- <private>db password: ${SECRET}</private>\n`,
    "cerebrum.md": `# C\n\n## Do-Not-Repeat\n- never do X\n- <private>client Z hasn't paid</private>\n`,
  });
  const digest = buildDigest(wolf, 1500);
  assert.ok(!digest.includes(SECRET), "secret leaked into the digest");
  assert.ok(!/<private>/i.test(digest), "private marker leaked into the digest");
  assert.ok(digest.includes("ship it"), "non-private content must survive");
  cleanup();
});

test("recall never returns a line from inside a <private> block", () => {
  const { wolf, cleanup } = makeWolf({
    "memory.md": `# M\n\n- public note about redis\n<private>redis password is ${SECRET}</private>\n`,
  });
  const hits = recall(wolf, "redis", 8);
  assert.ok(hits.length > 0, "the public line should still be found");
  assert.ok(!hits.some((h) => h.text.includes(SECRET)), "secret leaked through recall");
  cleanup();
});

test("read_wolf_file never returns a <private> block", () => {
  const { wolf, cleanup } = makeWolf({ "memory.md": `# M\n\n<private>api key ${SECRET}</private>\n` });
  const out = readWolfFile(wolf, "memory.md");
  assert.ok(!out.includes(SECRET), "secret leaked through read_wolf_file");
  cleanup();
});

test("an unclosed <private> tag hides everything after it (fail closed)", () => {
  // A forgotten closing tag must not mean "not private" — that turns one typo into a full leak.
  const { wolf, cleanup } = makeWolf({ "memory.md": `# M\n\n<private>oops no closing tag\n${SECRET}\nmore\n` });
  const out = readWolfFile(wolf, "memory.md");
  assert.ok(!out.includes(SECRET), "unclosed private block leaked");
  cleanup();
});

test("blanking keeps line numbers intact so citations stay honest", () => {
  const text = "line1\n<private>secret</private>\nline3";
  assert.equal(blankPrivate(text).split("\n").length, text.split("\n").length);
});

test("recall reports the right line number after a private block", () => {
  const { wolf, cleanup } = makeWolf({
    "memory.md": `first\n<private>${SECRET}</private>\nthird line mentions kafka\n`,
  });
  const [hit] = recall(wolf, "kafka", 5);
  assert.equal(hit.line, 3, "line number shifted — a citation would point at the wrong line");
  cleanup();
});

// An open bug presented as fixed is the one thing the model must not believe.
test("the digest marks open bugs as open, not as fixed", () => {
  const { wolf, cleanup } = makeWolf({
    "buglog.json": JSON.stringify({ bugs: [
      { id: "bug-1", error_message: "thing A broke", fix: "did the thing", tags: ["gefixt"] },
      { id: "bug-2", error_message: "thing B broke", fix: "OFFEN. Richtung: …", tags: ["offen"] },
    ] }),
  });
  const digest = buildDigest(wolf, 1500);
  assert.ok(!/already fixed/i.test(digest), "heading still claims everything is fixed");
  assert.match(digest, /STILL OPEN.*thing B broke/);
  assert.match(digest, /fixed\].*thing A broke/);
  cleanup();
});

test("isOpenBug treats an unknown state as open", () => {
  assert.equal(isOpenBug({ fix: "" }), true, "no fix recorded → assume open");
  assert.equal(isOpenBug({ fix: "OFFEN. Richtung: …" }), true);
  assert.equal(isOpenBug({ fix: "replaced the regex", tags: [] }), false);
  assert.equal(isOpenBug({ fix: "offen", tags: ["gefixt"] }), false, "an explicit tag wins");
});

// A 220k buglog sliced at 8k characters is unparseable JSON and ~2k wasted tokens.
test("read_wolf_file renders the buglog instead of cutting the JSON in half", () => {
  const bugs = Array.from({ length: 200 }, (_, i) => ({
    id: `bug-${i}`, error_message: `symptom ${i} `.repeat(20),
    root_cause: `cause ${i} `.repeat(20), fix: `fix ${i} `.repeat(20), tags: ["gefixt"],
  }));
  const { wolf, cleanup } = makeWolf({ "buglog.json": JSON.stringify({ bugs }) });
  const out = readWolfFile(wolf, "buglog.json", 4000);
  assert.ok(out.length <= 4400, `output not bounded: ${out.length} chars`);
  assert.match(out, /^200 entries in buglog\.json, newest \d+ shown:/);
  assert.match(out, /## bug-199 \[fixed\]/, "newest entry should be first");
  assert.ok(!out.includes('{"bugs"'), "raw JSON must not be handed over");
  cleanup();
});

test("recall bounds each hit so one long line cannot flood the context", () => {
  const { wolf, cleanup } = makeWolf({ "STATUS.md": "# S\n\n- " + "very long status line about kafka ".repeat(40) + "\n" });
  const [hit] = recall(wolf, "kafka", 5);
  assert.ok(hit.text.length <= 241, `hit not bounded: ${hit.text.length} chars`);
  cleanup();
});

test("remember writes only into the agent's own area and never the canonical files", () => {
  const { wolf, cleanup } = makeWolf({ "memory.md": "# canonical\n" });
  const before = fs.readFileSync(path.join(wolf, "memory.md"), "utf-8");
  const res = remember(wolf, "qwen", "the deploy needs the VPN");
  assert.match(res, /local\/qwen\/memory\.md/);
  assert.equal(fs.readFileSync(path.join(wolf, "memory.md"), "utf-8"), before, "canonical memory.md was modified");
  const own = fs.readFileSync(path.join(wolf, "local", "qwen", "memory.md"), "utf-8");
  assert.match(own, /the deploy needs the VPN/);
  cleanup();
});

test("a hostile agent id cannot escape the local area", () => {
  const { wolf, cleanup } = makeWolf({});
  remember(wolf, "../../etc", "nope");
  assert.ok(fs.existsSync(path.join(wolf, "local")), "write should stay under .wolf/local");
  assert.ok(!fs.existsSync(path.join(wolf, "..", "..", "etc", "memory.md")));
  cleanup();
});

test("an inline private block hides only itself, not the rest of the line", () => {
  // Real files carry lines like `- deploy runs at 04:00 <private>token: …</private>`. Blanking must
  // take the block and leave the sentence, otherwise turning one word private silently deletes a
  // useful line from recall.
  const { wolf, cleanup } = makeWolf({
    "memory.md": `# M\n\n- kafka consumer restarts nightly <private>token ${SECRET}</private>\n`,
  });
  const [hit] = recall(wolf, "kafka", 5);
  assert.ok(hit, "the public part of the line must still be findable");
  assert.match(hit.text, /kafka consumer restarts nightly/);
  assert.ok(!hit.text.includes(SECRET), "private part leaked");
  cleanup();
});
