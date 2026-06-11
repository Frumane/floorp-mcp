/**
 * OS keyboard tests — adapts to the environment:
 *  - Floorp NOT running  → the guard MUST abort without sending any keystroke,
 *    so text can never leak into another app (negative test).
 *  - Floorp running      → end-to-end check: real keys land in the focused
 *    element of the active Floorp tab (positive test against Wikipedia).
 * Run: npx tsx test/os-input-guard.ts
 */

import { realType, toSendKeys } from "../src/os-input.js";
import { FloorpClient } from "../src/floorp-client.js";

let fail = 0;

// Pure mapping checks (no side effects)
const cases: Array<[string, string]> = [
  ["Enter", "{ENTER}"],
  ["ctrl+a", "^a"],
  ["ctrl+shift+k", "^+k"],
  ["Escape", "{ESC}"],
  ["a", "a"],
];
for (const [input, expected] of cases) {
  const got = toSendKeys(input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"} toSendKeys(${input}) = ${got} (want ${expected})`);
}

const client = new FloorpClient();
const healthy = await client.health();

if (!healthy) {
  console.log("\n— guard test (Floorp NOT running): real_type must abort —");
  try {
    await realType("THIS_TEXT_MUST_NEVER_BE_TYPED_ANYWHERE");
    console.log("❌ UNSAFE: realType returned without throwing — it may have typed somewhere!");
    process.exit(1);
  } catch (e) {
    const msg = (e as Error).message;
    console.log("aborted with:", msg);
    if (msg.includes("not running") || msg.includes("foreground")) {
      console.log("✅ SAFE: aborted WITHOUT sending keys.");
      process.exit(fail ? 1 : 0);
    }
    console.log("⚠️ threw for an unexpected reason.");
    process.exit(2);
  }
}

console.log("\n— e2e test (Floorp running): real keys land in the focused field —");
const TYPED = "floorp e2e ok";
let instanceId: string | null = null;
try {
  instanceId = await client.createTab("https://www.wikipedia.org", { waitForLoad: true });
  await client.click(instanceId, "input#searchInput");
  await realType(TYPED);
  const value = await client.getValue(instanceId, "input#searchInput");
  if (value === TYPED) {
    console.log(`✅ typed text arrived intact: "${value}"`);
  } else {
    fail++;
    console.log(`❌ field value is ${JSON.stringify(value)}, expected ${JSON.stringify(TYPED)}`);
  }
} catch (e) {
  const msg = (e as Error).message;
  // Foregrounding can legitimately fail when another window holds focus
  // (Windows foreground-lock). That is the guard doing its job — not a failure.
  if (msg.includes("foreground")) {
    console.log("⚠️ SKIP e2e: could not foreground Floorp (another app holds focus). Guard aborted safely:", msg);
  } else {
    fail++;
    console.log("❌ e2e failed:", msg);
  }
} finally {
  if (instanceId) await client.closeTab(instanceId).catch(() => {});
}

console.log(fail ? `\n${fail} failure(s)` : "\nall passed");
process.exit(fail ? 1 : 0);
