// The gate: did the agent recommend something this turn without running twocents first?
import { open } from "node:fs/promises";

// Phrases that mark a judgment-call recommendation. Shadow mode exists to measure how often these misfire.
const RECOMMEND = [
  /\bI(?:'d| would)? (?:strongly )?recommend\b/i,
  /\bmy (?:recommendation|suggestion|pick)\b/i,
  /\bI(?:'d| would) (?:go with|pick|choose|use|lean (?:toward|towards))\b/i,
  /\bI suggest\b/i,
  /\b(?:the )?best (?:option|choice|bet) (?:is|here is|would be)\b/i,
  /\byou should (?:go with|pick|choose|use)\b/i,
  /\brecommendation:/i,
  // A comparative verdict: "X is the stronger headline", "B is better", "A wins".
  /\b(?:is|are) (?:the )?(?:stronger|better|clearer|safer|stronger pick|right call|winner)\b/i,
  /\b(?:wins|edges it|is the one)\b[.!,]/i,
  // An answer that opens with an imperative pick: "Use B", "**Go with option 2**", "Pick the plugin."
  /^[\s*_#>-]*(?:use|go with|pick|choose|ship)\s+(?:option\s+)?(?:[A-Z0-9]\b|["'“]|the\b)/im,
];

export function detectRecommendation(text = "") {
  for (const re of RECOMMEND) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

const RUN = /(?:^|[\s/"'`;&|(])twocents["'`]?\s+run\b/;
export const isJevRun = (command = "") => RUN.test(command);

const isRealPrompt = (o) =>
  o.type === "user" && !o.isSidechain && !o.isMeta &&
  (typeof o.message?.content === "string" ||
    (Array.isArray(o.message?.content) && !o.message.content.some((b) => b?.type === "tool_result")));

// Reads only the tail of the transcript: the current turn is always at the end.
export async function readTail(path, bytes = 4 * 1024 * 1024) {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // first line may be cut in half
    return lines.filter(Boolean);
  } finally {
    await fh.close();
  }
}

// Looks at everything after the last real user prompt.
export function analyseTurn(lines) {
  const rows = [];
  for (const l of lines) {
    try {
      rows.push(JSON.parse(l));
    } catch {}
  }
  let start = -1;
  for (let i = rows.length - 1; i >= 0; i--) if (isRealPrompt(rows[i])) { start = i; break; }
  const turn = rows.slice(start + 1).filter((o) => !o.isSidechain);
  const texts = [];
  let jevRan = false;
  for (const o of turn) {
    if (o.type !== "assistant" || !Array.isArray(o.message?.content)) continue;
    for (const b of o.message.content) {
      if (b?.type === "text") texts.push(b.text);
      if (b?.type === "tool_use" && b.name === "Bash" && isJevRun(b.input?.command)) jevRan = true;
    }
  }
  return { turnStartedAt: start >= 0 ? rows[start].timestamp ?? null : null, lastText: texts.at(-1) ?? "", jevRan };
}

// shadow: log only. enforce: block once, then let the agent stop. off: nothing.
export function gateAction({ mode = "shadow", recommended, jevRan, stopHookActive }) {
  if (mode === "off" || !recommended || jevRan) return "allow";
  if (mode === "enforce" && !stopHookActive) return "block";
  return "allow";
}
