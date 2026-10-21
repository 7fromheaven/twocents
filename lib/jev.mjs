// Minimal Jev (TypeSafe System One) client. The key comes from TYPESAFE_API_KEY or a key file, and is never logged.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export function createJev({ model = "jev-1.14.0", keyPath = join(homedir(), ".typesafe-key") } = {}) {
  let key;
  return async function ask(state, questions) {
    key ??= process.env.TYPESAFE_API_KEY?.trim() || (await readFile(keyPath, "utf8")).trim();
    const body = JSON.stringify({ model, state, questions });
    for (let i = 0; i < 6; i++) {
      const r = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body });
      if (r.ok) return { model, answers: (await r.json()).answers };
      if (![429, 500, 502, 503, 529].includes(r.status)) throw new Error(`Jev ${r.status}: ${(await r.text()).slice(0, 200)}`);
      await new Promise((s) => setTimeout(s, 1000 * 2 ** i));
    }
    throw new Error("Jev: retries exhausted");
  };
}
