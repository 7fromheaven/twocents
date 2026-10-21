import test from "node:test";
import assert from "node:assert/strict";
import { realpath, mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDigest } from "../lib/transcripts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const line = (o) => JSON.stringify(o);
const prompt = (text, ts, cwd) => line({ type: "user", timestamp: ts, cwd, message: { role: "user", content: text } });
const say = (text) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const bash = (command) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command } }] } });

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "jev-tr-")));
  const repo = join(base, "shop");
  await mkdir(join(repo, ".git"), { recursive: true });
  const enc = repo.replace(/[^a-zA-Z0-9]/g, "-");
  const tdir = join(base, "projects");
  await mkdir(join(tdir, enc), { recursive: true });
  await mkdir(join(tdir, enc + "-extra"), { recursive: true }); // a different repo whose name starts the same way
  await writeFile(join(tdir, enc, "s1.jsonl"), [
    prompt("which headline is better, A or B?", "2026-10-10T10:00:00Z", repo), say("I'd go with B."),
    prompt("fix the build error", "2026-10-10T11:00:00Z", repo), say("Fixed."),
    prompt("no, stop sounding like an auditor", "2026-10-10T12:00:00Z", repo), say("Understood."),
    prompt("what do you suggest for the logo colours?", "2026-10-11T09:00:00Z", repo), bash("twocents run b.json"), say("Jev picked red."),
    prompt("here is a doc <pasted_content id=\"x\">SECRET-PASTE which option</pasted_content id=\"x\"> thoughts?", "2026-10-12T09:00:00Z", repo), say("ok"),
  ].join("\n"));
  await writeFile(join(tdir, enc + "-extra", "s2.jsonl"), [prompt("which price should we pick?", "2026-10-10T10:00:00Z", repo + "-extra"), say("A")].join("\n"));
  return { base, repo, tdir };
}

test("buildDigest: finds choices and corrections for this repo only, marks Jev use, strips pastes", async () => {
  const { repo, tdir } = await fixture();
  process.env.TWOCENTS_TRANSCRIPTS = tdir;
  const { stats, text } = await buildDigest(repo, { now: Date.now() });
  assert.equal(stats.sessions, 2, "both folders are scanned...");
  assert.equal(stats.prompts, 5, "...but the other repo's session is dropped by its cwd");
  assert.equal(stats.choices, 2);
  assert.equal(stats.choicesWithJev, 1);
  assert.equal(stats.corrections, 1);
  assert.match(text, /which headline is better/);
  assert.match(text, /\[Jev used\]: what do you suggest for the logo/);
  assert.match(text, /stop sounding like an auditor/);
  assert.doesNotMatch(text, /which price should we pick/);
  assert.doesNotMatch(text, /SECRET-PASTE/);
  assert.doesNotMatch(text, /fix the build error/);
  delete process.env.TWOCENTS_TRANSCRIPTS;
});

test("cli scan writes a private digest before the repo has a project", async () => {
  const { base, repo, tdir } = await fixture();
  const env = { ...process.env, TWOCENTS_HOME: join(base, "home"), TWOCENTS_TRANSCRIPTS: tdir };
  const r = spawnSync("node", [join(root, "bin", "twocents"), "scan"], { cwd: repo, env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const path = r.stdout.match(/digest: (.+)/)[1].trim();
  assert.match(await readFile(path, "utf8"), /which headline is better/);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});
