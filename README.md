# twocents

A second opinion your coding agent must ask for and you can overrule.

Your agent (Claude Code, Codex and others) generates options. [Jev](https://typesafe.ai), TypeSafe AI's decision model, judges them. You decide. Every decision goes into a ledger, and your rules become context for the next one.

> Not affiliated with, endorsed by or sponsored by TypeSafe AI, Inc. "TypeSafe" and "Jev" are TypeSafe's names. twocents is an independent tool that calls the Jev API with your own account.

## What it does
- **Tailors itself to each repo.** On first use it reads your past sessions there, locally, and drafts readers, criteria and rules for that business for you to approve.
- Sends the options to Jev in **both orders** and flags any answer that flips with order.
- Hides the agent's own pick from Jev.
- Loads a small **context pack** and your **active rulings** into every call.
- Uses **criteria you approve**, each with a note on what it rewards and what it could bias.
- Flags: order flip, thin margin, low confidence, unapproved criteria, and agent-versus-Jev disagreement. Any flag means "escalate to the human".
- Appends every decision, and your final choice, to `ledger.jsonl`. `twocents stats` shows how often Jev and the agent agree with you.
- In Claude Code, a **stop gate** notices when the agent recommends something without a Jev check.

## You need your own Typesafe API key
twocents calls Jev, so you need your own account and key from TypeSafe. Put the key in the `TYPESAFE_API_KEY` environment variable, or in a file at `~/.typesafe-key` (`chmod 600`). Never commit it. Each decision makes two Jev calls, one per option order. Check TypeSafe's current pricing and terms.

Please keep to TypeSafe's terms of service (see https://typesafe.ai/legal/mca):
- Each user runs twocents with their own account. Do not resell or host Jev access for other people through it.
- Do not use Jev's outputs, including the ledger, to train a model that imitates Jev or to build a competing product.

## Claude Code plugin
```
/plugin marketplace add 7fromheaven/twocents
/plugin install twocents@twocents
```
Or try it for one session without installing: `claude --plugin-dir /path/to/twocents`.

The first time you open a Claude Code session in a repo, the plugin offers **onboarding** (`/twocents:onboard`):
1. **Reads your sessions:** it reads that repo's Claude Code sessions from the last 30 days, on your machine.
2. **Drafts a setup for this business:** a context pack, the readers it serves, criteria for the choices you actually make there (copy, naming, design direction, pricing, emails, strategy), and candidate rulings taken from your own corrections.
3. **Shows what Jev would have changed:** a few past choices where it would have helped.
4. **You approve each part.** Raw prompts never leave your machine; only the context pack you approve is sent to Jev with each decision.

Each repo gets its own project, so a luxury shop and a B2B studio are never judged by the same reader. Say no and it won't ask again in that repo (`twocents link --skip`). Two repos for one business can share a project (`twocents link <name>`).

The plugin adds:
- **`/twocents:onboard`**, described above.
- **`/twocents:decide`**, a skill Claude also loads by itself on judgment calls: copy, naming, design direction, pricing and offers, emails, strategy. It writes neutral options and a brief with its own pick, runs Jev, and reports Jev's pick and flags before it recommends.
- **`twocents`** on the Bash PATH while the plugin is on.
- **A session-start note** telling Claude which project this repo uses and how many criteria and rulings it has, or offering onboarding if the repo has none.
- **A stop gate.** When Claude's answer recommends something and no Jev check ran that turn, the gate acts by mode:
  - `shadow` (default): logs it to `gate.jsonl`.
  - `enforce`: sends Claude back once to run the check, or to say in one line why it was not a judgment call. It never loops.
  - `off`: does nothing.

  Switch with `twocents gate enforce`, and see what it caught with `twocents gate`. Detection is phrase-based, so run shadow mode for a while and read the log before enforcing.

## CLI
```
twocents scan [--days 30]                  # local digest of this repo's past choices and corrections
twocents init my-project                   # scaffolds ~/.twocents/my-project/ and links this repo to it
twocents link my-project | --skip          # share a project with this repo, or stop the onboarding offer
twocents status                            # which project this repo uses
# edit ~/.twocents/my-project/context.json and criteria.json, then:
twocents run examples/brief.json
twocents human example-tagline B --reason "clearer" [--ruling "a rule to remember"]
twocents rulings [promote|retire <id>]
twocents criteria
twocents stats
twocents gate [shadow|enforce|off]
```
Outside the plugin, run it as `node bin/twocents ...`, or `npm link` it. Every command takes `--project name|dir`; otherwise it uses the project linked to the repo you are in. Project data lives in `~/.twocents/<name>/` (`config.json`, `context.json`, `criteria.json`, `rulings.json`, `ledger.jsonl`, `gate.jsonl`, `briefs/`), outside your repos. Repo links live in `~/.twocents/config.json`. The key is never printed. Tests: `npm test` (no network, fake Jev).

## Other agents
`skills/decide/SKILL.md` and `skills/onboard/SKILL.md` are plain agent skills. Copy them into any agent's skills folder and point it at `node /path/to/twocents/bin/twocents`. A Codex package and an MCP server come later.

## Honest limits (v0.3)
- Jev's confidence is not proof. In one independent test it was 72% accurate on answers with 0.9 or higher confidence. Thresholds here are starting points; tune them on the ledger.
- Order-swap catches position bias, not every bias. A criterion can still steer the answer, which is why a human approves each one. The facts and framing you put in the brief can steer it too.
- Rulings are in-context memory, not training. They can reinforce themselves, so promote one only after you confirm it, cap how many load, and retire stale ones.
- The stop gate spots recommendations by phrasing. It will miss some and catch some that aren't judgment calls. Shadow mode is how you measure that.
- Onboarding finds past choices by keywords, so it misses some. It only reads Claude Code sessions for now, not Codex.
- No evidence yet that this beats deciding without it. The ledger is how to find out.

## Not done yet
Calibration command, framing sweep, held-out check for rulings, a pairwise mode for many options, a Codex package, an MCP server, and a way to run another LLM as a second judge.

## Licence
MIT. See `LICENSE`.
