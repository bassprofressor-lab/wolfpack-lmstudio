// The OpenWolf knowledge layer, self-contained for the LM Studio plugin runtime.
//
// This mirrors the ideas in openwolf-enhanced (resume digest, BM25-ish recall) but reads the
// .wolf/ files directly so the plugin has no heavy dependency and installs cleanly in LM Studio.
// A later version can swap these for the real engine (import from "openwolf-enhanced").

import * as fs from "node:fs";
import * as path from "node:path";

export function wolfDirFor(projectRoot: string): string {
  return path.join(projectRoot, ".wolf");
}

/**
 * A local model's own write area: .wolf/local/<agentId>/. This is the ONLY place WolfPack writes.
 * The canonical .wolf/ files (STATUS, cerebrum, memory, buglog) — the authoritative area maintained
 * by openwolf / Claude Code — are never modified by a local model. Read is a union (everyone can
 * read everything); write is isolated per agent, so what Qwen records can be read, reviewed, and
 * promoted by a stronger model without ever being overwritten by it.
 */
export function localDir(wolfDir: string, agentId: string): string {
  return path.join(wolfDir, "local", safeAgentId(agentId));
}

/**
 * The agent id as it is used on disk: letters, digits, `.`, `_`, `-`, at most 40 characters. An id
 * made only of dots ("." or "..") is a path step, not a name — ".." put the "own area" at .wolf/
 * itself and `remember` wrote into the canonical memory.md — so it falls back to "local".
 */
export function safeAgentId(agentId: string): string {
  const safe = (agentId || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  return !safe || /^\.+$/.test(safe) ? "local" : safe;
}

const OPEN = "<private>";
const CLOSE = "</private>";

/**
 * Which characters sit inside Markdown code: a fenced block (``` or ~~~, only when it is closed) or
 * an inline code span (a backtick run closed by a run of the same length on the same line).
 * Returns one id per character, -1 for "not code". Unclosed fences and spans do not count as code:
 * treating them as code would turn a real private tag after them into a literal, which is the leak
 * direction.
 */
function codeSegments(text: string): Int32Array {
  const seg = new Int32Array(text.length).fill(-1);
  let id = 0;
  const lines: Array<{ start: number; end: number }> = [];
  for (let i = 0, start = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") { lines.push({ start, end: i }); start = i + 1; }
  }
  const isFence = (l: { start: number; end: number }) => /^\s{0,3}(```|~~~)/.test(text.slice(l.start, l.end));
  const inFence = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (!isFence(lines[i])) continue;
    const marker = text.slice(lines[i].start, lines[i].end).trim().slice(0, 3);
    let j = i + 1;
    while (j < lines.length && !(isFence(lines[j]) && text.slice(lines[j].start, lines[j].end).trim().startsWith(marker))) j++;
    if (j >= lines.length) continue; // unclosed fence: not code
    const fid = id++;
    for (let k = i; k <= j; k++) { inFence[k] = true; seg.fill(fid, lines[k].start, lines[k].end); }
    i = j;
  }
  for (let li = 0; li < lines.length; li++) {
    if (inFence[li]) continue;
    const { start, end } = lines[li];
    let i = start;
    while (i < end) {
      if (text[i] !== "`") { i++; continue; }
      let n = 0;
      while (i + n < end && text[i + n] === "`") n++;
      // find a closing run of exactly n backticks on the same line
      let j = i + n, close = -1;
      while (j < end) {
        if (text[j] !== "`") { j++; continue; }
        let m = 0;
        while (j + m < end && text[j + m] === "`") m++;
        if (m === n) { close = j; break; }
        j += m;
      }
      if (close === -1) { i += n; continue; } // unclosed span: not code
      seg.fill(id++, i, close + n);
      i = close + n;
    }
  }
  return seg;
}

/** Index of the next closing tag at or after `from`, below `limit`, in the given code segment. */
function findClose(lower: string, seg: Int32Array, from: number, limit: number, segId: number): number {
  let q = lower.indexOf(CLOSE, from);
  while (q !== -1 && q < limit) {
    if (seg[q] === segId) return q;
    q = lower.indexOf(CLOSE, q + 1);
  }
  return -1;
}

/**
 * Blank out <private>…</private>, keeping the line count intact.
 *
 * OPENWOLF.md promises that content wrapped this way stays out of the injected resume context and
 * out of recall results. Blanking (rather than deleting) keeps `recall`'s line numbers correct.
 *
 * The rules, in order of how they protect:
 *   • A closed pair is blanked wherever it is, also inside code. Pairing never crosses the border
 *     between code and prose, so a literal mention in backticks cannot swallow the text up to the
 *     next real block.
 *   • An unclosed tag at the start of a line (optionally after a list marker or `>`) is a block
 *     opener with a forgotten end: it hides everything to the end of the file. A forgotten closing
 *     tag must never mean "not private".
 *   • An unclosed tag in the middle of a line hides the rest of that line. Inline blocks are
 *     written on one line, so the line is the scope a writer meant.
 *   • An unclosed tag inside inline code or a closed fenced block is a mention of the syntax, not
 *     a block, and is left alone. The previous rule hid everything after such a mention: in a real
 *     knowledge base twelve of them, all documentation, hid 82 % of cerebrum.md and broke the
 *     buglog JSON, so the digest lost Do-Not-Repeat and every bug.
 */
export function blankPrivate(text: string): string {
  const lower = text.toLowerCase();
  if (!lower.includes(OPEN)) return text;
  const seg = codeSegments(text);
  const regions: Array<[number, number]> = [];
  let p = lower.indexOf(OPEN);
  while (p !== -1) {
    const s = seg[p];
    const lineEnd = (() => { const e = text.indexOf("\n", p); return e === -1 ? text.length : e; })();
    let end: number;
    if (s >= 0) {
      // inside code: only a pair within the same code segment counts
      let segEnd = p; while (segEnd < text.length && seg[segEnd] === s) segEnd++;
      const q = findClose(lower, seg, p + OPEN.length, segEnd, s);
      if (q === -1) { p = lower.indexOf(OPEN, p + OPEN.length); continue; }
      end = q + CLOSE.length;
    } else {
      const lineStart = text.lastIndexOf("\n", p - 1) + 1;
      const atBlockStart = /^\s*(?:[-*+>]\s*|\d+[.)]\s*)?$/.test(text.slice(lineStart, p));
      const q = findClose(lower, seg, p + OPEN.length, atBlockStart ? text.length : lineEnd, -1);
      end = q !== -1 ? q + CLOSE.length : atBlockStart ? text.length : lineEnd;
    }
    regions.push([p, end]);
    p = lower.indexOf(OPEN, end);
  }
  let out = "", last = 0;
  for (const [a, b] of regions) {
    out += text.slice(last, a) + text.slice(a, b).replace(/[^\n]/g, "");
    last = b;
  }
  return out + text.slice(last);
}

/** Apply blankPrivate to every string inside a parsed JSON value. */
function blankPrivateDeep(v: unknown): unknown {
  if (typeof v === "string") return blankPrivate(v);
  if (Array.isArray(v)) return v.map(blankPrivateDeep);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = blankPrivateDeep(val);
    return o;
  }
  return v;
}

/**
 * The single read path for every .wolf text file. Private regions are removed HERE, at the choke
 * point, so no caller can forget to do it — a new feature that reads a knowledge file is
 * private-safe by construction.
 */
function readFileSafe(p: string): string {
  try { return blankPrivate(fs.readFileSync(p, "utf-8")); } catch { return ""; }
}

/**
 * The read path for JSON knowledge files. Parse first, then blank each string value: a mention of
 * the tag inside one bug entry then costs the rest of that one field, not the rest of the file
 * (which used to break the JSON and drop every bug). A file that is not valid JSON as written is
 * returned as null rather than guessed at.
 */
function readJsonSafe(p: string): unknown {
  let raw: string;
  try { raw = fs.readFileSync(p, "utf-8"); } catch { return null; }
  try { return blankPrivateDeep(JSON.parse(raw)); } catch { return null; }
}

/** Extract one `## heading` section (heading line through the next `## ` or `---`). */
function extractSection(markdown: string, headingPattern: RegExp): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => headingPattern.test(l));
  if (start === -1) return "";
  const out: string[] = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]) || /^---\s*$/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

/**
 * Build a compact resume digest from the project's .wolf/ files: the current quest, the
 * Do-Not-Repeat list, recently fixed bugs, and the latest session line. Bounded to maxChars so it
 * stays cheap on a small local model's context window (proactive but not bloated).
 */
export function buildDigest(wolfDir: string, maxChars = 1500): string {
  const parts: string[] = [];
  let used = 0;
  const room = (): number => maxChars - used - 2;
  const add = (text: string): void => {
    if (!text || text.length > room()) return;
    parts.push(text);
    used += text.length + 2;
  };
  // A list section takes as many of its NEWEST entries as still fit. It used to be all or nothing,
  // and with the default budget the quest left too little room for the whole Do-Not-Repeat block,
  // so the digest never carried it.
  const addList = (heading: string, entries: string[], cap = Infinity): void => {
    const limit = Math.min(room(), cap);
    const picked: string[] = [];
    let len = heading.length;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (len + 1 + entries[i].length > limit) break;
      picked.unshift(entries[i]);
      len += 1 + entries[i].length;
    }
    if (picked.length > 0) add(heading + "\n" + picked.join("\n"));
  };

  // 1. Current quest / next steps — the single most valuable resume context, but capped at under
  //    half the budget so the lessons and bugs below still get room.
  const status = readFileSafe(path.join(wolfDir, "STATUS.md"));
  if (status) {
    const quest = extractSection(status, /^## (🚀|Next|🧭)/) || extractSection(status, /^## /);
    if (quest) add(trimTo(quest, Math.min(700, Math.floor(maxChars * 0.45))));
  }

  // 2. Do-Not-Repeat — the last few hard-won lessons, each bounded.
  const cerebrum = readFileSafe(path.join(wolfDir, "cerebrum.md"));
  if (cerebrum) {
    const dnr = extractSection(cerebrum, /^## Do-Not-Repeat/);
    const entries = dnr.split("\n").filter((l) => l.trim().startsWith("- ")).slice(-6).map((l) => trimTo(l.trim(), 240));
    // Leave the bugs below their share: at most 60 % of what the quest left over.
    addList("## Do-Not-Repeat", entries, Math.floor(room() * 0.6));
  }

  // 3. Recent bugs — so the model doesn't re-derive a known fix, and knows what is still broken.
  //
  // The heading used to say "already fixed" for whatever the last five entries were. A buglog also
  // carries OPEN entries, so the digest was telling the model a live bug was dealt with — the one
  // thing it must not believe. Status is read from the entry now instead of assumed.
  const bugs = readBugs(wolfDir).slice(-5);
  addList("## Recent bugs from the project's buglog", bugs.map((b) => {
    const state = isOpenBug(b) ? "STILL OPEN" : "fixed";
    const line = `- [${state}] ${b.error_message ?? "?"} → ${b.fix ?? "?"}`;
    return line.length > 160 ? line.slice(0, 157) + "…" : line;
  }));

  return parts.join("\n\n");
}

function trimTo(text: string, n: number): string {
  return text.length <= n ? text : text.slice(0, n - 1) + "…";
}

interface Bug { error_message?: string; root_cause?: string; fix?: string; id?: string; tags?: unknown }

/**
 * Is this entry still open? Read from what the log actually carries: an "offen"/"open" tag, or a fix
 * field that says so instead of describing a fix. Unknown counts as OPEN — telling the model a bug
 * is fixed when it is not is the expensive direction of this guess.
 */
export function isOpenBug(b: Bug): boolean {
  const tags = Array.isArray(b.tags) ? b.tags.map((t) => String(t).toLowerCase()) : [];
  if (tags.includes("offen") || tags.includes("open")) return true;
  if (tags.includes("gefixt") || tags.includes("fixed")) return false;
  const fix = (b.fix ?? "").trim();
  if (!fix) return true;
  return /^\s*(offen|open|todo|tbd)\b/i.test(fix);
}

export function readBugs(wolfDir: string): Bug[] {
  // readJsonSafe blanks private regions per string value, after parsing.
  const parsed = readJsonSafe(path.join(wolfDir, "buglog.json"));
  if (!parsed || typeof parsed !== "object") return [];
  const arr = Array.isArray(parsed) ? parsed : (parsed as { bugs?: unknown[] }).bugs;
  return Array.isArray(arr) ? (arr as Bug[]) : [];
}

export interface Hit { file: string; line: number; text: string; score: number }

/**
 * Lightweight keyword recall over the .wolf/ knowledge files. Substring matching (so "port" hits
 * "ports"), ranked by term frequency with a rare-term bias — a compact stand-in for the full BM25
 * engine in openwolf-enhanced. Searches cerebrum, memory, STATUS as lines and buglog per entry.
 */
export function recall(wolfDir: string, query: string, limit = 8, agentId?: string): Hit[] {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  if (terms.length === 0) return [];

  const docs: Array<{ file: string; line: number; text: string; lower: string }> = [];
  const addFile = (label: string, abspath: string) => {
    readFileSafe(abspath).split(/\r?\n/).forEach((text, i) => {
      if (text.trim().length > 0) docs.push({ file: label, line: i + 1, text: text.trim(), lower: text.toLowerCase() });
    });
  };
  // Canonical .wolf/ (read-only) …
  for (const name of ["cerebrum.md", "memory.md", "STATUS.md"]) addFile(name, path.join(wolfDir, name));
  // … plus this model's own area, so it can recall what it noted itself.
  if (agentId) addFile(`local/${safeAgentId(agentId)}/memory.md`, path.join(localDir(wolfDir, agentId), "memory.md"));
  readBugs(wolfDir).forEach((b, i) => {
    const text = [b.id, b.error_message, b.root_cause, b.fix].filter(Boolean).join(" — ");
    if (text) docs.push({ file: "buglog.json", line: i + 1, text, lower: text.toLowerCase() });
  });
  if (docs.length === 0) return [];

  // df per term for a rough idf weighting (rare term in a short line ranks highest).
  const df = new Map<string, number>();
  for (const t of terms) df.set(t, docs.reduce((c, d) => c + (d.lower.includes(t) ? 1 : 0), 0));

  const hits: Hit[] = [];
  for (const d of docs) {
    let score = 0, matched = 0;
    for (const t of terms) {
      const tf = d.lower.split(t).length - 1;
      if (tf === 0) continue;
      matched++;
      const idf = Math.log(1 + docs.length / (1 + (df.get(t) || 0)));
      score += idf * tf;
    }
    if (matched === 0) continue;
    // Reward lines that hit more of the query; mild length normalization.
    score *= 1 + matched / terms.length;
    score /= 1 + d.text.length / 400;
    // Cap each hit. STATUS.md lines run to ~700 characters here, and eight of them put ~1.000 tokens
    // into a small model's window for a single search. The hit is a pointer — read_wolf_file is the
    // way to see the whole thing.
    hits.push({ file: d.file, line: d.line, text: trimTo(d.text, 240), score: Math.round(score * 1000) / 1000 });
  }
  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  return hits.slice(0, limit);
}

/**
 * Save a fact into THIS model's own area only (.wolf/local/<agentId>/memory.md). Canonical .wolf/
 * files are never touched — a stronger model reviews and promotes from here; nothing here overwrites
 * the authoritative knowledge base.
 */
/** Longest note `remember` accepts. One fact is a sentence or two, not a document. */
export const MAX_FACT_CHARS = 1000;

export function remember(wolfDir: string, agentId: string, fact: string): string {
  const id = safeAgentId(agentId);
  const dir = localDir(wolfDir, id);
  const p = path.join(dir, "memory.md");
  // The model writes this text, possibly steered by a document it just read. A private tag in it
  // would open a block in the agent's own notes and hide every later note (unclosed at line start
  // means "to end of file"), so tags are neutralised. One line, bounded length.
  let text = fact.replace(/<(\/?)private>/gi, "[$1private]").replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (!text) return "Not saved: the fact was empty.";
  if (text.length > MAX_FACT_CHARS) text = text.slice(0, MAX_FACT_CHARS - 1) + "…";
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const line = `- [${stamp}] ${text}\n`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, `# Notes by \`${id}\` (local model)\n\n> Written via WolfPack LM Studio. This is ${id}'s own area — safe to review and promote; it never overwrites the canonical .wolf/ files.\n\n`, "utf-8");
    }
    fs.appendFileSync(p, line, "utf-8");
    return `Remembered → .wolf/local/${id}/memory.md (your own area)`;
  } catch (e) {
    return `Could not write note: ${(e as Error).message}`;
  }
}

const READABLE = new Set(["STATUS.md", "cerebrum.md", "memory.md", "buglog.json", "anatomy.md"]);

/** Read one whitelisted .wolf/ file, bounded so a huge file can't blow the context. */
export function readWolfFile(wolfDir: string, name: string, maxChars = 8000): string {
  if (!READABLE.has(name)) return `Not a readable .wolf file. Allowed: ${[...READABLE].join(", ")}`;

  // buglog.json is the one file where a character-count cut is actively harmful: at 220k it gets
  // sliced mid-string and the model receives ~2k tokens of unparseable JSON fragment. Rendered as
  // entries instead — the newest ones, which is what anyone asking for the buglog wants.
  if (name === "buglog.json") {
    const bugs = readBugs(wolfDir);
    if (bugs.length === 0) return "buglog.json is empty, missing, or unreadable.";
    const lines: string[] = [];
    let used = 0;
    for (const b of bugs.slice().reverse()) {
      const entry = [
        `## ${b.id ?? "?"} [${isOpenBug(b) ? "STILL OPEN" : "fixed"}]`,
        `symptom: ${trimTo((b.error_message ?? "?").replace(/\s+/g, " "), 300)}`,
        `cause:   ${trimTo((b.root_cause ?? "?").replace(/\s+/g, " "), 300)}`,
        `fix:     ${trimTo((b.fix ?? "?").replace(/\s+/g, " "), 300)}`,
      ].join("\n");
      if (used + entry.length + 2 > maxChars) break;
      lines.push(entry);
      used += entry.length + 2;
    }
    return `${bugs.length} entries in buglog.json, newest ${lines.length} shown:\n\n` + lines.join("\n\n");
  }

  const content = readFileSafe(path.join(wolfDir, name));
  if (!content.trim()) return `${name} is empty or missing.`;
  return content.length > maxChars ? content.slice(0, maxChars) + `\n…(truncated, ${content.length} chars total)` : content;
}

export function hasWolf(projectRoot: string): boolean {
  try { return fs.existsSync(wolfDirFor(projectRoot)); } catch { return false; }
}
