---
name: decide
description: Run a Jev second opinion before recommending on any judgment call between options where a reader, buyer or user decides what is right - copy, naming and titles, design direction and layout, pricing and offers, emails and newsletters, positioning and strategy. Use whenever the user asks "which is better / what should we use / what do you suggest / how would you do it", or before giving any such recommendation. Not for facts, code correctness or mechanical tasks.
---

# Decide: ask Jev before you recommend

Jev judges, the agent generates, the human decides. A recommendation on a judgment call is not ready until it has been through this loop.

## Steps

1. **Write the options.** Two to six real, distinct options. Write them neutrally. Do not make your favourite longer, better phrased or listed first.
2. **Write a brief** as JSON in the project's `briefs/` folder. The session-start message names the folder; by default it is `~/.twocents/<project>/briefs/<id>.json`. Fields: `id` (date plus a short slug), `decision`, `goal` (the user's goal in their own words, never your own assumption), `reader` (a key from the context pack's `readers`), `tags`, `criteria` (ids from `criteria.json`), `options` (letter keys), and `claude_pick` (your own pick, written before you see Jev's). Jev never sees `claude_pick`. Keep facts out of the brief unless they are needed; facts you choose can steer the answer.
3. **Check the criteria.** Run `twocents criteria`. Each criterion has a `could_bias` note. If a criterion could steer toward an answer the user would reject, say so and leave it out. Criteria with status `draft` are allowed but flagged. The user approves a criterion by changing its status to `approved`.
4. **Run it:** `twocents run <brief.json>`. In Claude Code the plugin puts `twocents` on the PATH. Elsewhere, run `node <path-to-twocents>/bin/twocents run <brief.json>`. The engine asks Jev in both option orders and flags order flips, thin margins, low confidence, unapproved criteria and agent-versus-Jev disagreement.
5. **Report to the user:** one recommendation, with Jev's pick and what moved it. If the verdict is `escalate`, show the flags plainly and let the user choose. Never re-judge or argue Jev down to make the flags go away.
6. **Record the user's choice** when they make it: `twocents human <id> <option> --reason "why"`, using the id that `run` printed (it adds `-2`, `-3` when an id is reused). If they state a rule ("never X"), add `--ruling "..."`; it saves as a candidate. Promote it with `twocents rulings promote <id>` only after the user confirms it.

## Rules
- Never ask Jev a question that carries your own preference.
- Never send private material to Jev: no secrets, client names, infrastructure, security details or private notes. The context pack and rulings must stay public-safe, because they are sent with every call.
- Do not average Jev's probabilities with your own judgment. Show both.
- For facts, code, mechanical edits and anything that has one right answer, skip this skill. If the stop gate asks about a turn like that, say in one line that it was not a judgment call.
- Jev's confidence is not proof. Use it as a flag, and check thresholds against the ledger (`twocents stats`).

## Files
Project home: `~/.twocents/<name>/` (`config.json`, `context.json`, `criteria.json`, `rulings.json`, `ledger.jsonl`, `gate.jsonl`, `briefs/`). Each repo is linked to its own project (`twocents status` shows which). If the repo has none, use the onboard skill first.
