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

function readFileSafe(p: string): string {
  try { return fs.readFileSync(p, "utf-8"); } catch { return ""; }
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
  const add = (text: string): void => {
    if (!text) return;
    if (used + text.length + 2 > maxChars) return;
    parts.push(text);
    used += text.length + 2;
  };

  // 1. Current quest / next steps — the single most valuable resume context.
  const status = readFileSafe(path.join(wolfDir, "STATUS.md"));
  if (status) {
    const quest = extractSection(status, /^## (🚀|Next|🧭)/) || extractSection(status, /^## /);
    if (quest) add(trimTo(quest, 700));
  }

  // 2. Do-Not-Repeat — the last few hard-won lessons.
  const cerebrum = readFileSafe(path.join(wolfDir, "cerebrum.md"));
  if (cerebrum) {
    const dnr = extractSection(cerebrum, /^## Do-Not-Repeat/);
    const entries = dnr.split("\n").filter((l) => l.trim().startsWith("- "));
    if (entries.length > 0) add("## Do-Not-Repeat\n" + entries.slice(-6).join("\n"));
  }

  // 3. Recently fixed bugs — so the model doesn't re-derive a known fix.
  const bugs = readBugs(wolfDir).slice(-5);
  if (bugs.length > 0) {
    add("## Known bugs already fixed\n" + bugs.map((b) => {
      const line = `- ${b.error_message ?? "?"} → ${b.fix ?? "?"}`;
      return line.length > 140 ? line.slice(0, 137) + "…" : line;
    }).join("\n"));
  }

  return parts.join("\n\n");
}

function trimTo(text: string, n: number): string {
  return text.length <= n ? text : text.slice(0, n - 1) + "…";
}

interface Bug { error_message?: string; root_cause?: string; fix?: string; id?: string; tags?: unknown }

export function readBugs(wolfDir: string): Bug[] {
  const raw = readFileSafe(path.join(wolfDir, "buglog.json"));
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
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
export function recall(wolfDir: string, query: string, limit = 8): Hit[] {
  const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
  if (terms.length === 0) return [];

  const docs: Array<{ file: string; line: number; text: string; lower: string }> = [];
  for (const name of ["cerebrum.md", "memory.md", "STATUS.md"]) {
    const content = readFileSafe(path.join(wolfDir, name));
    content.split(/\r?\n/).forEach((text, i) => {
      if (text.trim().length > 0) docs.push({ file: name, line: i + 1, text: text.trim(), lower: text.toLowerCase() });
    });
  }
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
    hits.push({ file: d.file, line: d.line, text: d.text, score: Math.round(score * 1000) / 1000 });
  }
  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
  return hits.slice(0, limit);
}

/** Append a fact to memory.md under a plugin-written note line (never touches canonical structure). */
export function remember(wolfDir: string, fact: string): string {
  const p = path.join(wolfDir, "memory.md");
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const line = `| ${hhmm} | (LM Studio note) ${fact.replace(/\|/g, "/").replace(/\n/g, " ")} | - | noted | ~0 |\n`;
  try {
    fs.appendFileSync(p, line, "utf-8");
    return `Remembered → .wolf/memory.md`;
  } catch (e) {
    return `Could not write memory.md: ${(e as Error).message}`;
  }
}

const READABLE = new Set(["STATUS.md", "cerebrum.md", "memory.md", "buglog.json", "anatomy.md"]);

/** Read one whitelisted .wolf/ file, bounded so a huge file can't blow the context. */
export function readWolfFile(wolfDir: string, name: string, maxChars = 8000): string {
  if (!READABLE.has(name)) return `Not a readable .wolf file. Allowed: ${[...READABLE].join(", ")}`;
  const content = readFileSafe(path.join(wolfDir, name));
  if (!content) return `${name} is empty or missing.`;
  return content.length > maxChars ? content.slice(0, maxChars) + `\n…(truncated, ${content.length} chars total)` : content;
}

export function hasWolf(projectRoot: string): boolean {
  try { return fs.existsSync(wolfDirFor(projectRoot)); } catch { return false; }
}
