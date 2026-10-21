---
name: onboard
description: Set up twocents for the current repo by reading the user's past Claude Code sessions here and drafting a context pack, readers, criteria and rulings for them to approve. Use when the session-start note says this repo has no twocents project, or when the user asks to onboard, set up or retune twocents.
---

# Onboard: tailor twocents to this repo

Every repo serves a different business and audience. A luxury shop, a news site and a B2B studio need different readers and criteria. This skill learns them from what the user has already asked and corrected in past sessions, then asks the user to approve each part.

## Steps

1. **Ask first.** In one short message, tell the user what will happen and wait for a yes:
   - twocents reads this repo's Claude Code sessions from the last 30 days, on this machine.
   - Raw prompts never go to Jev.
   - Only the context pack they approve is sent, with each decision.
   - If they say no or "not here", run `twocents link --skip` and stop.
2. **Scan:** `twocents scan` (add `--days 60` if the user wants a longer window). It prints counts and the path of a local digest of likely choices and corrections.
3. **Read** the digest, then the repo's README and CLAUDE.md (or AGENTS.md) if present, so you know what the business sells and to whom.
4. **Draft** these, based on what the digest shows the user actually decides here:
   - **Project name:** a short slug, such as the repo or business name.
   - **`context.json`:**
     - `about_you`: the user's role and how they write.
     - `about_the_product`: what it is, who it's for, and what makes it different.
     - `goal`: the current effort, in the user's own words where possible.
     - `audience`.
     - `style_rules`.
     - `readers`: 2 to 4 named readers, each one sentence, for example `buyer`, `local_viewer`, `broker`.
   - **`criteria.json`:** 3 to 6 criteria, all with `status: "draft"`.
     - Cover the kinds of choices that recur in the digest (copy, naming, design direction, pricing and offers, email, strategy).
     - Each needs `id`, `applies_to`, `question` (phrased from the reader's point of view), `rewards`, `could_bias` and `weight`.
     - Write `could_bias` honestly: what wrong answer this criterion could push toward.
   - **`rulings.json`:** candidate rulings taken from the user's corrections in the digest, such as "stop sounding like an auditor" or "no editorial fonts for a tech company".
     - Each has `id` (r-1, r-2...), `status: "candidate"`, `tags`, `text`, `from` (for example "your session, 2026-10-11") and `created` (today).
     - Only include rules the user stated, never your own.
   - **Missed calls:** a short table of up to 5 past choices where Jev would have helped and was not used. Give the date, a short description and the kind of choice. This shows the user why the setup is worth it.
5. **Make it public-safe.** Everything in `context.json` and in active rulings is sent to Jev on every call. Remove names of people and clients, unreleased numbers, prices not yet public, infrastructure, security details and anything from private notes. Describe businesses generically where needed. Tell the user what you removed.
6. **Show the user** the draft as clear tables: context fields, readers, criteria (question, rewards, could bias), candidate rulings, missed calls. Ask them to approve, edit or drop each part. Criteria stay `draft` unless the user approves them one by one. A ruling becomes `active` only when the user confirms it.
7. **Write it** after approval:
   - If a project with that name already exists (`init` refuses to overwrite one), ask the user whether this repo should share it (`twocents link <name>`, then merge in only the parts they approve) or get its own name.
   - Otherwise run `twocents init <name>`, which creates `~/.twocents/<name>/` and links this repo to it.
   - Overwrite the three JSON files there with the approved versions, setting `status` to match what the user approved.
   - Run `twocents criteria` and `twocents rulings` to show the final state.
8. **Close** in two lines: what is now set up, and that the next judgment call in this repo will go through the decide skill. Tell the user the digest stays at the printed path (readable only by them) and offer to delete it.

## Rules
- Never send the digest, prompts or anything quoted from them to Jev, to any web service, or into a commit.
- Never invent rules, readers or goals the user did not express. If the digest is thin (few sessions), say so and ask the user two or three questions instead.
- One repo, one project. If two repos serve the same business, the user can link the second with `twocents link <name>` instead of onboarding again.
