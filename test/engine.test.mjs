import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregate, decide, loadProject, recordHuman, setRulingStatus, stats, readLedger, activeRulings } from "../lib/engine.mjs";

const cfg = { margin: 0.15, abstain: 0.6 };
const crit = [{ id: "c1", question: "q1" }, { id: "c2", question: "q2", weight: 2 }];
const opts = { A: "a", B: "b", C: "c" };
const p = (a, b, c, conf = 0.9) => ({ probabilities: { A: a, B: b, C: c }, confidence: conf });

test("aggregate: agreeing orders give a clean pick and no flags", () => {
  const per = { forward: { c1: p(0.8, 0.1, 0.1), c2: p(0.7, 0.2, 0.1) }, reverse: { c1: p(0.7, 0.2, 0.1), c2: p(0.8, 0.1, 0.1) } };
  const r = aggregate(per, crit, opts, cfg);
  assert.equal(r.jevPick, "A");
  assert.deepEqual(r.flags, []);
});

test("aggregate: an order flip is flagged", () => {
  const per = { forward: { c1: p(0.6, 0.3, 0.1), c2: p(0.6, 0.3, 0.1) }, reverse: { c1: p(0.2, 0.7, 0.1), c2: p(0.2, 0.7, 0.1) } };
  const r = aggregate(per, crit, opts, cfg);
  assert.ok(r.flags.some((f) => f.startsWith("order flip")));
  assert.ok(r.flags.some((f) => f.startsWith("criterion flips")));
});

test("aggregate: thin margin and low confidence are flagged", () => {
  const per = { forward: { c1: p(0.4, 0.38, 0.22, 0.4), c2: p(0.4, 0.38, 0.22) }, reverse: { c1: p(0.4, 0.38, 0.22), c2: p(0.4, 0.38, 0.22) } };
  const r = aggregate(per, crit, opts, cfg);
  assert.ok(r.flags.some((f) => f.startsWith("thin margin")));
  assert.ok(r.flags.some((f) => f.startsWith("low confidence")));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dl-"));
  await writeFile(join(root, "ctx.json"), JSON.stringify({ about: "test", readers: { r: "a reader" } }));
  await writeFile(join(root, "config.json"), JSON.stringify({ context: join(root, "ctx.json") }));
  await writeFile(join(root, "criteria.json"), JSON.stringify([{ id: "c1", status: "approved", question: "q1", could_bias: "x" }, { id: "d1", status: "draft", question: "q2", could_bias: "y" }]));
  await writeFile(join(root, "rulings.json"), JSON.stringify([{ id: "r-1", status: "active", text: "keep it plain" }, { id: "r-2", status: "candidate", text: "not yet" }]));
  return loadProject(root);
}

// Fake Jev: always favours the first option it is shown, and records what state it received.
const fakeAsk = (seen) => async (state, questions) => {
  seen.push({ state, questions });
  const answers = {};
  for (const [id, q] of Object.entries(questions)) {
    const keys = Object.keys(q.criteria);
    answers[id] = { probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.8 : 0.2 / (keys.length - 1)])), confidence: 0.9 };
  }
  return { model: "fake-1", answers };
};

test("decide: never sends Claude's pick, sends only active rulings, flags unapproved criteria and disagreement", async () => {
  const project = await fixture();
  const seen = [];
  const row = await decide({ id: "t1", decision: "pick", goal: "g", options: { A: "a", B: "b" }, criteria: ["c1", "d1"], claude_pick: "B" }, project, { ask: fakeAsk(seen) });
  assert.equal(seen.length, 2);
  const sent = JSON.stringify(seen);
  assert.ok(!sent.includes("claude_pick") && !sent.includes("claudePick"));
  assert.deepEqual(seen[0].state.rulings, ["keep it plain"]);
  assert.ok(row.flags.some((f) => f.includes("not approved") && f.includes("d1")));
  assert.ok(row.flags.some((f) => f.startsWith("order flip")), "a fake that favours position must flip across orders");
  assert.equal(row.verdict, "escalate");
  assert.equal((await readLedger(project)).length, 1);
});

test("decide: a reused brief id gets a suffix so each decision stays addressable", async () => {
  const project = await fixture();
  const brief = { id: "same", decision: "pick", goal: "g", options: { A: "a", B: "b" }, criteria: ["c1"] };
  const first = await decide(brief, project, { ask: fakeAsk([]) });
  const second = await decide({ ...brief, options: { A: "x", B: "y" } }, project, { ask: fakeAsk([]) });
  assert.equal(first.id, "same");
  assert.equal(second.id, "same-2");
  const h = await recordHuman(project, "same", "B");
  assert.equal(h.choice, "B");
});

test("record human, ruling candidates and promotion", async () => {
  const project = await fixture();
  await decide({ id: "t2", decision: "pick", goal: "g", options: { A: "a", B: "b" }, criteria: ["c1"], claude_pick: "A" }, project, { ask: fakeAsk([]) });
  const h = await recordHuman(project, "t2", "B", { reason: "clearer", ruling: "say what we sell" });
  assert.equal(h.agreesWithClaude, false);
  const saved = JSON.parse(await readFile(project.rulingsPath, "utf8"));
  assert.equal(saved.at(-1).status, "candidate");
  assert.ok(!activeRulings({ ...project, rulings: saved }).includes("say what we sell"));
  await setRulingStatus(project, saved.at(-1).id, "active");
  const s = stats(await readLedger(project));
  assert.equal(s.humanRecorded, 1);
  await assert.rejects(() => recordHuman(project, "t2", "Z"), /choice must be one of/);
});
