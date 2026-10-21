#!/usr/bin/env node
// SessionStart hook. Tells the agent whether this repo has a twocents project, and offers onboarding the first time.
// Fails silently.
import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { dataHome, projectPath, readGlobalConfig, repoStatus } from "../lib/paths.mjs";
import { loadProject } from "../lib/engine.mjs";

const say = (text) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));

try {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = raw ? JSON.parse(raw) : {};
  if (process.env.TWOCENTS_HOOK_DEBUG) {
    await mkdir(dataHome(), { recursive: true });
    await appendFile(join(dataHome(), "hook-debug.jsonl"), JSON.stringify({ hook: "SessionStart", keys: Object.keys(input) }) + "\n");
  }
  const status = await repoStatus(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const gate = (await readGlobalConfig()).gate ?? "shadow";

  if (status.state === "new") {
    say(`twocents is installed but not set up for this repo (${status.root}). At a natural moment early in the session, offer the user onboarding in one or two lines: it reads this repo's past sessions locally and drafts readers, criteria and rulings for this business, for them to approve. If they agree, use the twocents onboard skill. If they decline, run \`twocents link --skip\` so you don't ask again. Don't interrupt an urgent task to offer it.`);
  } else if (status.state === "linked") {
    const dir = projectPath(status.project);
    if (!existsSync(join(dir, "config.json"))) {
      say(`This repo is linked to twocents project "${status.project}", but ${dir} is missing. Offer to run the onboard skill again.`);
    } else {
      const project = await loadProject(dir);
      const rulings = project.rulings.filter((r) => r.status === "active").length;
      const approved = project.criteria.filter((c) => c.status === "approved").length;
      const readers = Object.keys(project.readers).join(", ") || "none";
      say(`twocents is active (project "${status.project}", readers: ${readers}; ${approved}/${project.criteria.length} criteria approved, ${rulings} active rulings, gate: ${gate}). Project folder: ${dir} (write briefs to ${join(dir, "briefs")}). Before recommending on a judgment call between options (copy, naming, design direction, pricing, emails, strategy), use the decide skill and run \`twocents run\`. Skip it for facts, code and mechanical steps.`);
    }
  }
  // skipped: say nothing.
} catch (e) {
  process.stderr.write(`twocents session-start: ${e.message}\n`);
}
process.exit(0);
