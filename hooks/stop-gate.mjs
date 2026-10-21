#!/usr/bin/env node
// Stop hook. Checks whether the agent recommended something this turn without running twocents.
// Fails open: any error lets the agent stop normally.
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { analyseTurn, detectRecommendation, gateAction, readTail } from "../lib/gate.mjs";
import { dataHome, readGlobalConfig, resolveProjectDir } from "../lib/paths.mjs";
import { loadProject, readLedger } from "../lib/engine.mjs";

const readStdin = async () => {
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s ? JSON.parse(s) : {};
};

try {
  const input = await readStdin();
  if (process.env.TWOCENTS_HOOK_DEBUG) {
    await mkdir(dataHome(), { recursive: true });
    await appendFile(join(dataHome(), "hook-debug.jsonl"), JSON.stringify({ hook: "Stop", keys: Object.keys(input), stop_hook_active: input.stop_hook_active ?? null }) + "\n");
  }
  const mode = (await readGlobalConfig()).gate ?? "shadow";
  if (mode === "off") process.exit(0);

  const turn = input.transcript_path ? analyseTurn(await readTail(input.transcript_path)) : { lastText: "", jevRan: false, turnStartedAt: null };
  const text = input.last_assistant_message || turn.lastText;
  const phrase = detectRecommendation(text);

  const projectDir = await resolveProjectDir(undefined, input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!projectDir) process.exit(0); // repo not set up: the session-start note handles onboarding
  let jevRan = turn.jevRan;
  if (!jevRan && turn.turnStartedAt) {
    try {
      const project = await loadProject(projectDir);
      jevRan = (await readLedger(project)).some((r) => r.type === "decision" && r.ts >= turn.turnStartedAt);
    } catch {}
  }

  const action = gateAction({ mode, recommended: Boolean(phrase), jevRan, stopHookActive: Boolean(input.stop_hook_active) });
  if (phrase || jevRan || action !== "allow") {
    await mkdir(projectDir, { recursive: true });
    await appendFile(join(projectDir, "gate.jsonl"), JSON.stringify({ ts: new Date().toISOString(), session: input.session_id ?? null, mode, phrase, jevRan, action }) + "\n");
  }
  // Feedback rather than a hard block: same loop protection, no hook-error notice for the user.
  if (action === "block") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: `twocents: you recommended something ("${phrase}") without a Jev check this turn. If this is a judgment call between options, use the decide skill: write the brief, run \`twocents run\`, and report Jev's pick and flags. If it is not a judgment call (a fact, a code change, a single obvious step), say so in one line and stop.`,
      },
    }));
  }
} catch (e) {
  process.stderr.write(`twocents stop-gate: ${e.message}\n`);
}
process.exit(0);
