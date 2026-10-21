// Reads a repo's past Claude Code sessions, locally, and builds an onboarding digest.
// Nothing here calls Jev or any network service.
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const transcriptsHome = () => process.env.TWOCENTS_TRANSCRIPTS || join(homedir(), ".claude", "projects");
const encode = (p) => p.replace(/[^a-zA-Z0-9]/g, "-");

// Choices where a reader's preference decides the answer.
const CHOICE = /\b(which (one|is|should|would|option|version)|should (i|we)\b|better|best|recommend|what do you (think|suggest)|pick|choose|or should|vs\.?|versus|options?|prefer|go with|decide|tagline|headline|name (it|her|him|this)|naming|title|pricing|price|positioning|offer|copy|caption|subject line|design|layout|colou?rs?|logo|font|cta|punchline|does this (look|sound|read))\b/i;
// The user correcting the agent: raw material for rulings.
const CORRECTION = /(^|\s)(no[,. ]|nope|stop |don'?t |never |always |i hate|i don'?t like|wtf|wrong|not what|too (long|salesy|corporate|generic|wordy)|sounds? like ai|ai[- ]slop|i prefer|i'?d rather|that'?s not)/i;
const JEV = /typesafe|systemone|\bjev\b|twocents|jevolution/i;
const NOISE = ["<command", "<local-command", "<task-notification", "[SYSTEM", "Caveat:", "This session is being continued"];

function promptText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.some((b) => b?.type === "tool_result")) return null;
  return content.filter((b) => b?.type === "text").map((b) => b.text).join(" ");
}

export async function findTranscripts(root, { days = 30, now = Date.now() } = {}) {
  const home = transcriptsHome();
  let dirs = [];
  try {
    dirs = (await readdir(home)).filter((d) => d === encode(root) || d.startsWith(encode(root) + "-"));
  } catch {
    return [];
  }
  const files = [];
  for (const d of dirs) {
    for (const f of await readdir(join(home, d)).catch(() => [])) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(home, d, f);
      if ((await stat(p)).mtimeMs >= now - days * 86400000) files.push(p);
    }
  }
  return files;
}

// Turns of one transcript: the user's prompt, whether Jev ran, and the end of the agent's reply.
export function turnsOf(lines, root) {
  const turns = [];
  let cur = null, inRepo = null;
  for (const l of lines) {
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (o.cwd && inRepo === null) inRepo = o.cwd === root || o.cwd.startsWith(root + "/");
    if (o.isSidechain) continue;
    if (o.type === "user" && !o.isMeta) {
      const t = promptText(o.message?.content);
      if (t === null) continue;
      if (!t.trim() || NOISE.some((n) => t.trimStart().startsWith(n))) { cur = null; continue; }
      cur = { ts: o.timestamp ?? null, prompt: t.replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, "[pasted]"), jev: false, reply: "" };
      turns.push(cur);
    } else if (cur && o.type === "assistant" && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b?.type === "tool_use" && JEV.test(JSON.stringify(b.input ?? ""))) cur.jev = true;
        if (b?.type === "text") cur.reply = b.text;
      }
    }
  }
  return inRepo === false ? [] : turns;
}

const clip = (s, n) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };

export async function buildDigest(root, { days = 30, maxChars = 60000, now = Date.now() } = {}) {
  const files = await findTranscripts(root, { days, now });
  const turns = [];
  for (const f of files) turns.push(...turnsOf((await readFile(f, "utf8")).split("\n"), root));
  turns.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const choices = turns.filter((t) => CHOICE.test(t.prompt.slice(0, 1500)));
  const corrections = turns.filter((t) => CORRECTION.test(t.prompt.slice(0, 600)) && !choices.includes(t));
  const stats = { repo: root, days, sessions: files.length, prompts: turns.length, choices: choices.length, choicesWithJev: choices.filter((t) => t.jev).length, corrections: corrections.length };

  const out = [`# twocents onboarding digest`, ``, `Repo: ${root}`, `Window: last ${days} days. Sessions: ${stats.sessions}. Prompts: ${stats.prompts}. Likely choices: ${stats.choices} (Jev used on ${stats.choicesWithJev}). Corrections: ${stats.corrections}.`, ``,
    `This file stays on this machine. It holds raw prompts: never send it, or anything copied from it, to Jev.`, ``];
  // Choices get 60% of the space and corrections 40%, so neither crowds out the other.
  let size = out.join("\n").length;
  const section = (title, items, budget, fmt) => {
    out.push(``, title);
    let used = 0, shown = 0;
    for (const t of items) {
      const l = fmt(t);
      if (used + l.length > budget) break;
      out.push(l); used += l.length + 1; shown++;
    }
    if (shown < items.length) out.push(`(${items.length - shown} older items left out to fit the size limit.)`);
  };
  const room = Math.max(0, maxChars - size - 400);
  section(`## Choices the user made or asked about (newest first)`, choices, room * 0.6,
    (t) => `- ${String(t.ts).slice(0, 10)}${t.jev ? " [Jev used]" : ""}: ${clip(t.prompt, 500)}\n  agent ended: ${clip(t.reply.slice(-400), 300)}`);
  section(`## The user correcting the agent (candidate rulings)`, corrections, room * 0.4, (t) => `- ${String(t.ts).slice(0, 10)}: ${clip(t.prompt, 350)}`);
  return { stats, text: out.join("\n") + "\n" };
}
