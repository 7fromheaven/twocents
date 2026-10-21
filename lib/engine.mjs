// Decision loop engine: runs a brief through Jev in both option orders, flags disagreement, writes the ledger.
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const home = (p) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);
const r3 = (x) => Math.round(x * 1000) / 1000;
const readJson = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT" && fallback !== undefined) return fallback;
    throw e;
  }
};

export async function loadProject(dir) {
  const root = home(dir);
  const config = await readJson(join(root, "config.json"));
  const contextPath = home(config.context);
  const context = await readJson(isAbsolute(contextPath) ? contextPath : join(root, contextPath));
  const { _note, readers, ...contextFields } = context;
  return {
    root,
    config: { margin: 0.15, abstain: 0.6, maxRulings: 6, ...config },
    context: contextFields,
    readers: readers ?? {},
    criteria: await readJson(join(root, "criteria.json"), []),
    rulings: await readJson(join(root, "rulings.json"), []),
    ledgerPath: join(root, "ledger.jsonl"),
    rulingsPath: join(root, "rulings.json"),
  };
}

export const activeRulings = (project, tags = []) => {
  const live = project.rulings.filter((r) => r.status === "active");
  const tagged = live.filter((r) => !r.tags?.length || r.tags.some((t) => tags.includes(t)));
  return tagged.slice(-project.config.maxRulings).map((r) => r.text);
};

const reverse = (obj) => Object.fromEntries(Object.entries(obj).reverse());
const argmax = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Pure aggregation, so it can be tested without Jev.
export function aggregate(perOrder, criteria, options, cfg) {
  const keys = Object.keys(options);
  const weight = (c) => c.weight ?? 1;
  const totalW = criteria.reduce((a, c) => a + weight(c), 0);
  const overallFor = (orderName) =>
    Object.fromEntries(keys.map((k) => [k, criteria.reduce((a, c) => a + weight(c) * perOrder[orderName][c.id].probabilities[k], 0) / totalW]));
  const fwd = overallFor("forward"), rev = overallFor("reverse");
  const overall = Object.fromEntries(keys.map((k) => [k, (fwd[k] + rev[k]) / 2]));
  const ranked = Object.entries(overall).sort((a, b) => b[1] - a[1]);
  const flags = [];
  if (argmax(fwd) !== argmax(rev)) flags.push(`order flip: ${argmax(fwd)} first in the forward order, ${argmax(rev)} first in the reverse order`);
  const flipped = criteria.filter((c) => argmax(perOrder.forward[c.id].probabilities) !== argmax(perOrder.reverse[c.id].probabilities)).map((c) => c.id);
  if (flipped.length) flags.push(`criterion flips with option order: ${flipped.join(", ")}`);
  const margin = ranked[0][1] - ranked[1][1];
  if (margin < cfg.margin) flags.push(`thin margin: ${r3(margin)} (threshold ${cfg.margin})`);
  const lowConf = criteria.filter((c) => Math.min(perOrder.forward[c.id].confidence ?? 1, perOrder.reverse[c.id].confidence ?? 1) < cfg.abstain).map((c) => c.id);
  if (lowConf.length) flags.push(`low confidence (below ${cfg.abstain}): ${lowConf.join(", ")}`);
  return { overall: Object.fromEntries(ranked.map(([k, v]) => [k, r3(v)])), jevPick: ranked[0][0], margin: r3(margin), flags };
}

export async function decide(brief, project, { ask, now = () => new Date().toISOString() }) {
  const keys = Object.keys(brief.options ?? {});
  if (keys.length < 2) throw new Error("brief.options needs at least two options");
  const criteria = (brief.criteria ?? []).map((id) => {
    const c = project.criteria.find((x) => x.id === id);
    if (!c) throw new Error(`unknown criterion: ${id}`);
    return c;
  });
  if (!criteria.length) throw new Error("brief.criteria is empty");
  const flags = [];
  const drafts = criteria.filter((c) => c.status !== "approved").map((c) => c.id);
  if (drafts.length) flags.push(`criteria not approved by you: ${drafts.join(", ")}`);

  // Jev sees the context pack, the active rulings and the options. It never sees Claude's pick.
  const state = {
    ...project.context,
    ...(brief.reader && project.readers[brief.reader] ? { reader: project.readers[brief.reader] } : {}),
    decision: brief.decision,
    goal: brief.goal,
    rulings: activeRulings(project, brief.tags),
    ...(brief.state ?? {}),
  };
  const perOrder = {};
  let model;
  for (const [name, opts] of [["forward", brief.options], ["reverse", reverse(brief.options)]]) {
    const questions = Object.fromEntries(criteria.map((c) => [c.id, { type: "choice", criteria: opts, instructions: c.question }]));
    const res = await ask(state, questions);
    model = res.model;
    perOrder[name] = Object.fromEntries(criteria.map((c) => [c.id, { probabilities: res.answers[c.id].probabilities, confidence: res.answers[c.id].confidence ?? null }]));
  }
  const agg = aggregate(perOrder, criteria, brief.options, project.config);
  flags.unshift(...agg.flags);
  if (brief.claude_pick && brief.claude_pick !== agg.jevPick) flags.push(`Claude and Jev disagree: Claude picked ${brief.claude_pick}, Jev picked ${agg.jevPick}`);
  // Ids must stay unique so `human <id>` records against the decision the user actually saw.
  const taken = new Set((await readLedger(project)).filter((r) => r.type === "decision").map((r) => r.id));
  const base = brief.id || now().slice(0, 10);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  const row = {
    type: "decision", id, ts: now(), model, decision: brief.decision, goal: brief.goal,
    options: brief.options, criteria: criteria.map((c) => ({ id: c.id, status: c.status, weight: c.weight ?? 1 })),
    perOrder, overall: agg.overall, jevPick: agg.jevPick, margin: agg.margin, claudePick: brief.claude_pick ?? null,
    flags, verdict: flags.length ? "escalate" : "proceed", rulingsUsed: state.rulings,
  };
  await mkdir(project.root, { recursive: true });
  await appendFile(project.ledgerPath, JSON.stringify(row) + "\n");
  return row;
}

export async function readLedger(project) {
  try {
    return (await readFile(project.ledgerPath, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

export async function recordHuman(project, id, choice, { reason = "", ruling = null, now = () => new Date().toISOString() } = {}) {
  const rows = await readLedger(project);
  const d = rows.filter((r) => r.type === "decision" && r.id === id).at(-1);
  if (!d) throw new Error(`no decision with id ${id}`);
  if (!(choice in d.options)) throw new Error(`choice must be one of: ${Object.keys(d.options).join(", ")}`);
  const row = { type: "human", id, ts: now(), choice, reason, agreesWithJev: choice === d.jevPick, agreesWithClaude: d.claudePick ? choice === d.claudePick : null };
  await appendFile(project.ledgerPath, JSON.stringify(row) + "\n");
  if (ruling) {
    project.rulings.push({ id: `r-${project.rulings.length + 1}`, text: ruling, from: id, status: "candidate", created: row.ts });
    await writeFile(project.rulingsPath, JSON.stringify(project.rulings, null, 2) + "\n");
  }
  return row;
}

export async function setRulingStatus(project, id, status) {
  const r = project.rulings.find((x) => x.id === id);
  if (!r) throw new Error(`no ruling ${id}`);
  r.status = status;
  await writeFile(project.rulingsPath, JSON.stringify(project.rulings, null, 2) + "\n");
  return r;
}

export function stats(rows) {
  const decisions = rows.filter((r) => r.type === "decision");
  const humans = new Map(rows.filter((r) => r.type === "human").map((r) => [r.id, r]));
  const judged = decisions.filter((d) => humans.has(d.id));
  const pct = (n, d) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "n/a");
  return {
    decisions: decisions.length,
    humanRecorded: judged.length,
    escalated: pct(decisions.filter((d) => d.verdict === "escalate").length, decisions.length),
    jevAgreesWithHuman: pct(judged.filter((d) => humans.get(d.id).agreesWithJev).length, judged.length),
    agentAgreesWithHuman: pct(judged.filter((d) => humans.get(d.id).agreesWithClaude === true).length, judged.filter((d) => d.claudePick).length),
    orderFlips: decisions.filter((d) => d.flags.some((f) => f.startsWith("order flip") || f.startsWith("criterion flips"))).length,
  };
}
