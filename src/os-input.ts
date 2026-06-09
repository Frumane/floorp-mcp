/**
 * OS-level keyboard input for Floorp (Windows only).
 *
 * Why: synthetic DOM events (Floorp's /input, dispatchTextInput) don't reliably
 * sync React/Slate-controlled editors, so submits silently fail. Real OS key
 * events (isTrusted=true) are processed exactly like a human typing, which fixes
 * rich-editor typing AND form submission — on the user's *live* session.
 *
 * SAFETY (non-negotiable): OS keystrokes go to whatever window is in the
 * foreground. So before sending ANY key we:
 *   1. require a Floorp window to exist,
 *   2. bring it to the foreground,
 *   3. VERIFY it is actually foreground,
 *   4. abort WITHOUT sending keys if verification fails.
 * This prevents leaking keystrokes into the wrong app.
 *
 * Usage: focus the target field first (e.g. with the `click` tool), then call
 * realType / realKeys. The element keeps DOM focus while Floorp is foregrounded.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const pexec = promisify(execFile);

// PowerShell script: foreground-guard + send keys. param-based, no backticks so
// it survives being stored in a JS template literal.
const PS_SCRIPT = `param([string]$Mode, [string]$Payload)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FloorpInput {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
"@
$proc = $null
for ($try = 0; $try -lt 6; $try++) {
  $proc = Get-Process | Where-Object { $_.ProcessName -match 'floorp' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($proc) { break }
  [System.Threading.Thread]::Sleep(150)
}
if (-not $proc) { Write-Output 'ERR:NO_FLOORP'; exit 3 }
$h = $proc.MainWindowHandle
$fg = [FloorpInput]::GetForegroundWindow()
$t1 = [FloorpInput]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
$t2 = [FloorpInput]::GetCurrentThreadId()
[void][FloorpInput]::AttachThreadInput($t2, $t1, $true)
[void][FloorpInput]::ShowWindow($h, 5)
[void][FloorpInput]::BringWindowToTop($h)
[void][FloorpInput]::SetForegroundWindow($h)
[void][FloorpInput]::AttachThreadInput($t2, $t1, $false)
[System.Threading.Thread]::Sleep(180)
if ([FloorpInput]::GetForegroundWindow() -ne $h) { Write-Output 'ERR:NOT_FOREGROUND'; exit 4 }
Add-Type -AssemblyName System.Windows.Forms
$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Payload))
function Esc([string]$c) {
  switch -CaseSensitive ($c) {
    '{' { return '{{}' }
    '}' { return '{}}' }
    '[' { return '{[}' }
    ']' { return '{]}' }
    '(' { return '{(}' }
    ')' { return '{)}' }
    '+' { return '{+}' }
    '^' { return '{^}' }
    '%' { return '{%}' }
    '~' { return '{~}' }
    default { return $c }
  }
}
if ($Mode -eq 'type') {
  foreach ($ch in $text.ToCharArray()) {
    $code = [int][char]$ch
    if ($code -eq 13) { continue }
    if ($code -eq 10) { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
    else { [System.Windows.Forms.SendKeys]::SendWait((Esc ([string]$ch))) }
    [System.Threading.Thread]::Sleep(6)
  }
} else {
  [System.Windows.Forms.SendKeys]::SendWait($text)
}
Write-Output 'OK'
`;

let scriptPath: string | null = null;
function ensureScript(): string {
  if (!scriptPath) {
    scriptPath = join(tmpdir(), "floorp-mcp-osinput.ps1");
    writeFileSync(scriptPath, PS_SCRIPT, "utf8");
  }
  return scriptPath;
}

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

async function runPs(mode: "type" | "keys", payload: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("OS keyboard input is currently Windows-only.");
  }
  const file = ensureScript();
  let stdout = "";
  try {
    const res = await pexec(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, "-Mode", mode, "-Payload", b64(payload)],
      { windowsHide: true, timeout: 60_000 },
    );
    stdout = res.stdout;
  } catch (err: any) {
    stdout = (err.stdout ?? "") + (err.stderr ?? err.message ?? "");
  }
  if (stdout.includes("ERR:NO_FLOORP")) {
    throw new Error("Floorp is not running (no window found). Open Floorp and try again.");
  }
  if (stdout.includes("ERR:NOT_FOREGROUND")) {
    throw new Error(
      "Could not bring Floorp to the foreground — aborted WITHOUT sending any keys " +
        "(safety guard, so keystrokes can't leak to another app). Click the Floorp window, then retry.",
    );
  }
  if (!stdout.includes("OK")) {
    throw new Error(`OS input failed: ${stdout.trim().slice(0, 300)}`);
  }
}

/** Type text into Floorp's focused element via real OS key events. */
export function realType(text: string): Promise<void> {
  return runPs("type", text);
}

/** Map a friendly key/combo name to SendKeys notation. */
const KEY_MAP: Record<string, string> = {
  enter: "{ENTER}",
  tab: "{TAB}",
  escape: "{ESC}",
  esc: "{ESC}",
  backspace: "{BS}",
  delete: "{DEL}",
  del: "{DEL}",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
};

const MODIFIERS: Record<string, string> = { ctrl: "^", control: "^", alt: "%", shift: "+" };

/** Translate "Enter", "Tab", "ctrl+a", "ctrl+shift+k" → SendKeys notation. */
export function toSendKeys(key: string): string {
  const parts = key.split("+").map((p) => p.trim().toLowerCase());
  const main = parts.pop()!;
  const mods = parts.map((m) => MODIFIERS[m] ?? "").join("");
  const mapped = KEY_MAP[main] ?? (main.length === 1 ? main : `{${main.toUpperCase()}}`);
  return mods + mapped;
}

/** Press a single key or combo via real OS key events. */
export function realKey(key: string): Promise<void> {
  return runPs("keys", toSendKeys(key));
}

/** Select-all + delete via real OS key events (clears rich/contenteditable fields). */
export function realClear(): Promise<void> {
  return runPs("keys", "^a{DEL}");
}

// -- OS mouse (v1.0.0) --------------------------------------------------------
// Moves the real OS cursor and clicks. SAFETY: same foreground guard as the
// keyboard PLUS a bounds check — the click is sent only when Floorp is verified
// foreground AND the (x,y) point lies inside Floorp's window rect, so a stray
// coordinate can never click another app/window.

const MOUSE_SCRIPT = `param([int]$X, [int]$Y, [string]$Action)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FloorpMouse {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$proc = $null
for ($try = 0; $try -lt 6; $try++) {
  $proc = Get-Process | Where-Object { $_.ProcessName -match 'floorp' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($proc) { break }
  [System.Threading.Thread]::Sleep(150)
}
if (-not $proc) { Write-Output 'ERR:NO_FLOORP'; exit 3 }
$h = $proc.MainWindowHandle
$r = New-Object FloorpMouse+RECT
[void][FloorpMouse]::GetWindowRect($h, [ref]$r)
if ($Action -eq 'bounds') { Write-Output ("BOUNDS:" + $r.Left + "," + $r.Top + "," + $r.Right + "," + $r.Bottom); exit 0 }
$fg = [FloorpMouse]::GetForegroundWindow()
$t1 = [FloorpMouse]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
$t2 = [FloorpMouse]::GetCurrentThreadId()
[void][FloorpMouse]::AttachThreadInput($t2, $t1, $true)
[void][FloorpMouse]::ShowWindow($h, 5)
[void][FloorpMouse]::BringWindowToTop($h)
[void][FloorpMouse]::SetForegroundWindow($h)
[void][FloorpMouse]::AttachThreadInput($t2, $t1, $false)
[System.Threading.Thread]::Sleep(150)
if ([FloorpMouse]::GetForegroundWindow() -ne $h) { Write-Output 'ERR:NOT_FOREGROUND'; exit 4 }
if ($X -lt $r.Left -or $X -gt $r.Right -or $Y -lt $r.Top -or $Y -gt $r.Bottom) {
  Write-Output ("ERR:OUT_OF_BOUNDS rect=" + $r.Left + "," + $r.Top + "," + $r.Right + "," + $r.Bottom); exit 5
}
[void][FloorpMouse]::SetCursorPos($X, $Y)
[System.Threading.Thread]::Sleep(40)
if ($Action -eq 'click') { [FloorpMouse]::mouse_event(2,0,0,0,[IntPtr]::Zero); [FloorpMouse]::mouse_event(4,0,0,0,[IntPtr]::Zero) }
elseif ($Action -eq 'double') { for ($i=0; $i -lt 2; $i++) { [FloorpMouse]::mouse_event(2,0,0,0,[IntPtr]::Zero); [FloorpMouse]::mouse_event(4,0,0,0,[IntPtr]::Zero); [System.Threading.Thread]::Sleep(70) } }
elseif ($Action -eq 'right') { [FloorpMouse]::mouse_event(8,0,0,0,[IntPtr]::Zero); [FloorpMouse]::mouse_event(16,0,0,0,[IntPtr]::Zero) }
Write-Output 'OK'
`;

let mouseScriptPath: string | null = null;
function ensureMouseScript(): string {
  if (!mouseScriptPath) {
    mouseScriptPath = join(tmpdir(), "floorp-mcp-osmouse.ps1");
    writeFileSync(mouseScriptPath, MOUSE_SCRIPT, "utf8");
  }
  return mouseScriptPath;
}

async function runMouse(x: number, y: number, action: "move" | "click" | "double" | "right" | "bounds"): Promise<string> {
  if (process.platform !== "win32") throw new Error("OS mouse is currently Windows-only.");
  const file = ensureMouseScript();
  let stdout = "";
  try {
    const res = await pexec(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file,
       "-X", String(Math.round(x)), "-Y", String(Math.round(y)), "-Action", action],
      { windowsHide: true, timeout: 30_000 },
    );
    stdout = res.stdout;
  } catch (err: any) {
    stdout = (err.stdout ?? "") + (err.stderr ?? err.message ?? "");
  }
  if (stdout.includes("ERR:NO_FLOORP")) throw new Error("Floorp is not running (no window found).");
  if (stdout.includes("ERR:NOT_FOREGROUND")) {
    throw new Error("Could not bring Floorp to the foreground — aborted WITHOUT clicking (safety guard).");
  }
  if (stdout.includes("ERR:OUT_OF_BOUNDS")) {
    const rect = stdout.match(/rect=([\-\d,]+)/)?.[1] ?? "";
    throw new Error(
      `(${x},${y}) is outside the Floorp window [${rect}] — refused to click outside Floorp. ` +
        `Call window_bounds for the valid range.`,
    );
  }
  if (!stdout.includes("OK") && !stdout.includes("BOUNDS:")) {
    throw new Error(`OS mouse failed: ${stdout.trim().slice(0, 200)}`);
  }
  return stdout;
}

/** Move the real OS cursor to a screen pixel (must be inside the Floorp window). */
export function moveCursor(x: number, y: number): Promise<void> {
  return runMouse(x, y, "move").then(() => {});
}

/** Real OS mouse click at a screen pixel inside the Floorp window. */
export function realClick(
  x: number,
  y: number,
  opts: { button?: "left" | "right"; double?: boolean } = {},
): Promise<void> {
  const action = opts.double ? "double" : opts.button === "right" ? "right" : "click";
  return runMouse(x, y, action).then(() => {});
}

/** Floorp window rectangle in screen pixels (so callers can target real_click). */
export async function floorpWindowBounds(): Promise<{
  left: number; top: number; right: number; bottom: number; width: number; height: number;
}> {
  const out = await runMouse(0, 0, "bounds");
  const m = out.match(/BOUNDS:(-?\d+),(-?\d+),(-?\d+),(-?\d+)/);
  if (!m) throw new Error("Could not read Floorp window bounds: " + out.trim().slice(0, 120));
  const [, L, T, R, B] = m.map(Number);
  return { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T };
}
