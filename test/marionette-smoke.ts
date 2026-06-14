/** Proves the Marionette client works end-to-end against a headless Gecko browser.
 *  Launches Floorp (any Gecko binary via FLOORP_PATH) headless with -marionette on
 *  a throwaway profile, drives it, prints raw result shapes, then quits.
 *  Run: npx tsx test/marionette-smoke.ts */
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarionetteClient } from "../src/marionette.js";

const EXE =
  process.env.FLOORP_PATH ||
  ["C:\\Program Files\\Ablaze Floorp\\floorp.exe", "C:\\Program Files (x86)\\Ablaze Floorp\\floorp.exe"].find((p) => existsSync(p)) ||
  "floorp";
const PORT = Number(process.env.MARIONETTE_PORT) || 2829; // 2829 to avoid clashing with a real 2828
const profile = mkdtempSync(join(tmpdir(), "fmcp-mar-"));
// Pin the Marionette port via a profile pref (the -marionette flag reads marionette.port).
writeFileSync(join(profile, "user.js"), `user_pref("marionette.port", ${PORT});\n`);

const waitPort = (port: number, ms: number) =>
  new Promise<boolean>((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const s = connect({ host: "127.0.0.1", port }, () => { s.destroy(); resolve(true); });
      s.on("error", () => { s.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(tick, 300); });
    };
    tick();
  });

console.log(`launching: ${EXE}  (headless, marionette :${PORT}, profile ${profile})`);
const child = spawn(EXE, ["-headless", "-marionette", "-no-remote", "-profile", profile], {
  env: { ...process.env, MOZ_MARIONETTE: "1", MARIONETTE_PORT: String(PORT) },
  stdio: "ignore",
  detached: false,
});

let ok = true;
const log = (label: string, v: unknown) => console.log(`  ${label}:`, JSON.stringify(v)?.slice(0, 160));

try {
  const up = await waitPort(PORT, 30_000);
  if (!up) throw new Error("Marionette port never opened — does this Floorp build support -marionette?");
  console.log("✅ marionette port open");

  const m = new MarionetteClient({ port: PORT, timeoutMs: 30_000 });
  await m.connect();
  console.log("✅ connected + hello received");
  await m.newSession();
  console.log("✅ newSession, sessionId =", m.sessionId);

  await m.send("WebDriver:Navigate", { url: "https://example.com/" });
  log("GetCurrentURL", await m.send("WebDriver:GetCurrentURL"));
  log("GetTitle", await m.send("WebDriver:GetTitle"));
  const src = await m.send<{ value?: string }>("WebDriver:GetPageSource");
  console.log("  GetPageSource has 'Example Domain':", /Example Domain/.test(src?.value ?? ""));
  log("GetWindowHandles", await m.send("WebDriver:GetWindowHandles"));
  const shot = await m.send<{ value?: string }>("WebDriver:TakeScreenshot", { full: true });
  console.log("  TakeScreenshot base64 length:", (shot?.value ?? "").length);
  const exec = await m.send("WebDriver:ExecuteScript", { script: "return document.title + '|' + location.host;", args: [] });
  log("ExecuteScript", exec);

  m.close();
  console.log("\n✅ Marionette protocol works end-to-end");
} catch (e) {
  ok = false;
  console.error("❌ FAIL:", (e as Error).message);
} finally {
  try { child.kill(); } catch { /* ignore */ }
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(ok ? 0 : 1); }, 1500);
}
