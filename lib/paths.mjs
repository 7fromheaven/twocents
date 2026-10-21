// Where twocents keeps its data, and which project a repo uses.
// TWOCENTS_HOME overrides ~/.twocents (used by tests and sandboxes).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";

export const dataHome = () => process.env.TWOCENTS_HOME || join(homedir(), ".twocents");

export async function readGlobalConfig() {
  try {
    return JSON.parse(await readFile(join(dataHome(), "config.json"), "utf8"));
  } catch {
    return {};
  }
}

export async function writeGlobalConfig(patch) {
  const next = { ...(await readGlobalConfig()), ...patch };
  await mkdir(dataHome(), { recursive: true });
  await writeFile(join(dataHome(), "config.json"), JSON.stringify(next, null, 2) + "\n");
  return next;
}

// A bare name is a project under the home folder; anything with a slash or ~ is a path.
export const projectPath = (v) => (v.startsWith("~") ? join(homedir(), v.slice(1)) : v.includes("/") ? v : join(dataHome(), v));

// The repo a directory belongs to: the nearest folder with .git, or the directory itself.
// Resolves symlinks (macOS /tmp is /private/tmp) to match the paths Claude Code records.
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
export function repoRoot(dir = process.cwd()) {
  let d = real(dir);
  while (true) {
    if (existsSync(join(d, ".git"))) return d;
    const up = dirname(d);
    if (up === d) return real(dir);
    d = up;
  }
}

// repos maps a repo root to a project name, or to null when the user skipped onboarding there.
export async function linkRepo(root, project) {
  const cfg = await readGlobalConfig();
  return writeGlobalConfig({ repos: { ...(cfg.repos ?? {}), [root]: project } });
}

export async function repoStatus(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const repos = (await readGlobalConfig()).repos ?? {};
  if (!(root in repos)) return { root, state: "new" };
  if (repos[root] === null) return { root, state: "skipped" };
  return { root, state: "linked", project: repos[root] };
}

// --project, then TWOCENTS_PROJECT, then the repo's link. No silent fallback to another business's project.
export async function resolveProjectDir(explicit, cwd = process.cwd()) {
  const name = explicit ?? process.env.TWOCENTS_PROJECT ?? (await repoStatus(cwd)).project;
  return name ? projectPath(name) : null;
}
