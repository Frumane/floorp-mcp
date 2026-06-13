/** End-to-end test of the PUBLISHED npm package. Spawns the server from a clean
 *  install (path in FLOORP_MCP_SERVER) via an MCP client and exercises it against
 *  live Floorp — i.e. exactly what a real `npx floorp-mcp` user gets.
 *  Run: $env:FLOORP_MCP_SERVER="<temp>\node_modules\floorp-mcp\dist\index.js"; npx tsx test/install-smoke.ts */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const server = process.env.FLOORP_MCP_SERVER;
if (!server) { console.error("Set FLOORP_MCP_SERVER to the installed dist/index.js path."); process.exit(2); }

const transport = new StdioClientTransport({ command: "node", args: [server] });
const client = new Client({ name: "install-smoke", version: "0.0.0" });
await client.connect(transport);
const txt = (r: any) => (r.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
async function call(n: string, a: Record<string, unknown> = {}) {
  const r: any = await client.callTool({ name: n, arguments: a });
  return { text: txt(r).trim(), isError: !!r.isError };
}
let pass = 0, fail = 0;
const chk = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log("✅ " + l); } else { fail++; console.log("❌ " + l + "  " + d); } };

const tools = (await client.listTools()).tools.map((t) => t.name);
chk(`lists tools (${tools.length})`, tools.length >= 35, `got ${tools.length}`);
chk("has v1.5.0 'find' tool", tools.includes("find"));
chk("has OS-input tools", ["real_type", "real_click", "window_bounds"].every((t) => tools.includes(t)));

await call("launch_floorp");
const opened = await call("open_tab", { url: "https://example.com" });
const browserId = opened.text.match(/browserId:\s*(\d+)/)?.[1];
chk("open_tab returns a browserId", !!browserId, opened.text.slice(0, 100));

const found = await call("find", { text: "Example Domain", browserId });
chk("find locates 'Example Domain'", !found.isError && /example domain/i.test(found.text), found.text.slice(0, 120));

const page = await call("read_page", { browserId });
chk("read_page returns content", /example domain/i.test(page.text), page.text.slice(0, 80));

// SSRF guard must still be active in the published build
const ssrf = await call("open_tab", { url: "http://127.0.0.1:58261/tabs/list" });
chk("SSRF guard active (loopback refused)", ssrf.isError, ssrf.text.slice(0, 100));

if (browserId) await call("close_tab", { browserId });
console.log(`\n${pass} passed, ${fail} failed`);
await client.close();
process.exit(fail ? 1 : 0);
