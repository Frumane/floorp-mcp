/** v1.0.0 smoke test: OS mouse (window_bounds, out-of-bounds guard, move_cursor). */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "v10-test", version: "0.0.0" });
await client.connect(transport);
function txt(r: any): string {
  return (r.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
}
async function call(n: string, a: Record<string, unknown> = {}) {
  const r: any = await client.callTool({ name: n, arguments: a });
  return { text: txt(r).trim(), isError: !!r.isError };
}
let pass = 0, fail = 0;
const chk = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log("✅ " + l); } else { fail++; console.log("❌ " + l + "  " + d); } };

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log(`tools (${tools.length})`);
chk("tool count >= 34", tools.length >= 34, `got ${tools.length}`);
for (const t of ["window_bounds", "move_cursor", "real_click"]) chk(`tool present: ${t}`, tools.includes(t));

const wb = await call("window_bounds");
chk("window_bounds returns rect", /left=-?\d+ top=-?\d+ right=-?\d+ bottom=-?\d+/.test(wb.text), wb.text);
console.log(" ", wb.text);
const m = wb.text.match(/left=(-?\d+) top=(-?\d+) right=(-?\d+) bottom=(-?\d+)/);
let cx = 0, cy = 0;
if (m) { const [, L, T, R, B] = m.map(Number); cx = Math.round((L + R) / 2); cy = Math.round((T + B) / 2); }

const oob = await call("real_click", { x: 999999, y: 999999 });
chk("real_click out-of-bounds REJECTED (safety)", oob.isError && /outside the Floorp window/i.test(oob.text), oob.text);

const mv = await call("move_cursor", { x: cx, y: cy });
chk("move_cursor to window center (no click)", !mv.isError, mv.text);

console.log(`\n${pass} passed, ${fail} failed`);
await client.close();
process.exit(fail ? 1 : 0);
