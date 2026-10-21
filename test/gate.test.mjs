import test from "node:test";
import assert from "node:assert/strict";
import { realpath, mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyseTurn, detectRecommendation, gateAction, isJevRun } from "../lib/gate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("detectRecommendation: catches recommendation phrasing, ignores plain reports", () => {
  for (const s of ["My recommendation: ship D.", "I'd go with option B.", "I recommend the plugin.", "The best option is A.", "I suggest we wait.",
    '**Use B: "Fewer no-shows."**', "Go with option 2.", "Pick the layered build.", "Recommendation: D.",
    '"One price. Every chair covered." is the stronger headline.', "B is better for owners.", "Option A wins."]) assert.ok(detectRecommendation(s), s);
  for (const s of ["Tests pass. Pushed to main.", "The file has 3 lines.", "Done: renamed the folder.", "I used the CLI to run the tests.",
    "Run `npm test` to check."]) assert.equal(detectRecommendation(s), null, s);
});

test("isJevRun: matches the CLI however it is invoked", () => {
  for (const c of ["twocents run b.json", "node bin/twocents run b.json", "cd x && twocents run b.json --project p"]) assert.ok(isJevRun(c), c);
  for (const c of ["twocents stats", "npm run test", "echo twocents"]) assert.equal(isJevRun(c), false, c);
});

const line = (o) => JSON.stringify(o);
const prompt = (text, ts) => line({ type: "user", timestamp: ts, message: { role: "user", content: text } });
const say = (text) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const bash = (command) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command } }] } });
const result = () => line({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } });

test("analyseTurn: only looks at the current turn", () => {
  const lines = [prompt("old question", "2026-01-01T00:00:00Z"), bash("twocents run old.json"), result(), say("I'd go with A."),
    prompt("new question", "2026-01-02T00:00:00Z"), say("Thinking..."), say("My recommendation: B.")];
  const t = analyseTurn(lines);
  assert.equal(t.jevRan, false, "a Jev run from an earlier turn must not count");
  assert.equal(t.lastText, "My recommendation: B.");
  assert.equal(t.turnStartedAt, "2026-01-02T00:00:00Z");
  const t2 = analyseTurn([...lines.slice(0, 5), bash("twocents run new.json"), result(), say("Jev picked B. My recommendation: B.")]);
  assert.equal(t2.jevRan, true);
});

test("gateAction: shadow never blocks, enforce blocks once, off does nothing", () => {
  const base = { recommended: true, jevRan: false, stopHookActive: false };
  assert.equal(gateAction({ ...base, mode: "shadow" }), "allow");
  assert.equal(gateAction({ ...base, mode: "enforce" }), "block");
  assert.equal(gateAction({ ...base, mode: "enforce", stopHookActive: true }), "allow");
  assert.equal(gateAction({ ...base, mode: "enforce", jevRan: true }), "allow");
  assert.equal(gateAction({ ...base, mode: "off" }), "allow");
});

// Runs the real hook scripts as Claude Code would: JSON on stdin, environment for paths.
async function sandbox(gate) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "jev-home-")));
  const repo = join(home, "repo");
  await mkdir(join(repo, ".git"), { recursive: true });
  await mkdir(join(home, "p"), { recursive: true });
  await writeFile(join(home, "config.json"), JSON.stringify({ repos: { [repo]: "p" }, gate }));
  await writeFile(join(home, "p", "config.json"), JSON.stringify({ context: "./context.json" }));
  await writeFile(join(home, "p", "context.json"), JSON.stringify({ about: "test" }));
  await writeFile(join(home, "p", "criteria.json"), "[]");
  await writeFile(join(home, "p", "rulings.json"), "[]");
  const transcript = join(home, "t.jsonl");
  await writeFile(transcript, [prompt("which headline?", "2026-01-02T00:00:00Z"), say("My recommendation: go with D.")].join("\n") + "\n");
  return { home, repo, transcript };
}
const runHook = (file, home, input) =>
  spawnSync("node", [join(root, "hooks", file)], { input: JSON.stringify(input), env: { ...process.env, TWOCENTS_HOME: home }, encoding: "utf8" });

test("stop-gate hook: shadow logs, enforce returns feedback, stop_hook_active lets it stop", async () => {
  const s = await sandbox("shadow");
  let r = runHook("stop-gate.mjs", s.home, { session_id: "s1", cwd: s.repo, transcript_path: s.transcript, stop_hook_active: false });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  const log = (await readFile(join(s.home, "p", "gate.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(log[0].action, "allow");
  assert.equal(log[0].jevRan, false);

  const e = await sandbox("enforce");
  r = runHook("stop-gate.mjs", e.home, { session_id: "s2", cwd: e.repo, transcript_path: e.transcript, stop_hook_active: false });
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "Stop");
  assert.match(out.hookSpecificOutput.additionalContext, /without a Jev check/);
  r = runHook("stop-gate.mjs", e.home, { session_id: "s2", cwd: e.repo, transcript_path: e.transcript, stop_hook_active: true });
  assert.equal(r.stdout, "", "second stop in a row must be allowed");
  r = runHook("stop-gate.mjs", e.home, { session_id: "s3", cwd: e.home, transcript_path: e.transcript, stop_hook_active: false });
  assert.equal(r.stdout, "", "a repo without a project is never gated");
});

test("stop-gate hook fails open on bad input", async () => {
  const s = await sandbox("enforce");
  const r = spawnSync("node", [join(root, "hooks", "stop-gate.mjs")], { input: "not json", env: { ...process.env, TWOCENTS_HOME: s.home }, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("session-start hook: active project, first-time onboarding offer, silent when skipped", async () => {
  const s = await sandbox("shadow");
  let r = runHook("session-start.mjs", s.home, { session_id: "s1", source: "startup", cwd: join(s.repo) });
  let out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /twocents is active \(project "p"/);

  const other = join(s.home, "other");
  await mkdir(join(other, ".git"), { recursive: true });
  r = runHook("session-start.mjs", s.home, { cwd: join(other) });
  out = JSON.parse(r.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /not set up for this repo/);
  assert.match(out.hookSpecificOutput.additionalContext, /onboard skill/);

  const cfg = JSON.parse(await readFile(join(s.home, "config.json"), "utf8"));
  await writeFile(join(s.home, "config.json"), JSON.stringify({ ...cfg, repos: { ...cfg.repos, [other]: null } }));
  r = runHook("session-start.mjs", s.home, { cwd: other });
  assert.equal(r.stdout, "", "a skipped repo gets no note");
});

const cli = (cwd, env, ...a) => spawnSync("node", [join(root, "bin", "twocents"), ...a], { cwd, env, encoding: "utf8" });

test("cli: init links the current repo; other repos have no project until onboarded; link --skip", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "jev-cli-")));
  const env = { ...process.env, TWOCENTS_HOME: home };
  const repoA = join(home, "a"), repoB = join(home, "b");
  await mkdir(join(repoA, ".git", "x"), { recursive: true });
  await mkdir(join(repoB, ".git"), { recursive: true });
  await mkdir(join(repoA, "src"), { recursive: true });
  let r = cli(repoA, env, "init", "demo");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(home, "demo", "criteria.json")));
  r = cli(join(repoA, "src"), env, "criteria");
  assert.equal(r.status, 0, "a subfolder uses the repo's project: " + r.stderr);
  assert.match(r.stdout, /clarity/);
  r = cli(repoB, env, "criteria");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No twocents project/);
  r = cli(repoB, env, "link", "--skip");
  assert.equal(JSON.parse(await readFile(join(home, "config.json"), "utf8")).repos[repoB], null);
  r = cli(repoB, env, "link", "demo");
  assert.equal(JSON.parse(await readFile(join(home, "config.json"), "utf8")).repos[repoB], "demo");
  r = cli(repoB, env, "gate", "enforce");
  assert.equal(JSON.parse(await readFile(join(home, "config.json"), "utf8")).gate, "enforce");
});
