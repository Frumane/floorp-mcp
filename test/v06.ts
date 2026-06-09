/** v0.6.0 re-test on robust selectors + load wait. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "v06-test", version: "0.0.0" });
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
chk("tool count = 31", tools.length === 31, `got ${tools.length}`);

const opened = await call("open_tab", { url: "https://en.wikipedia.org/wiki/Mozilla_Firefox" });
const browserId = opened.text.match(/browserId:\s*(\d+)/)?.[1];
chk("open_tab returns browserId", !!browserId, opened.text);

await call("wait_for_element", { selector: "#firstHeading", state: "visible", timeoutMs: 10000, browserId });

const hov = await call("hover", { selector: "#firstHeading", browserId });
chk("hover #firstHeading", !hov.isError, hov.text);

const attr = await call("get_attribute", { selector: "#firstHeading", name: "id", browserId });
chk("get_attribute id=firstHeading", attr.text === "firstHeading", `got: ${attr.text}`);

const art = await call("get_article", { browserId });
chk("get_article returns real content", !art.isError && /firefox/i.test(art.text) && art.text.length > 500, `len=${art.text.length}: ${art.text.slice(0, 80)}`);
console.log("article head:", art.text.slice(0, 140), "\n");

const lw = await call("list_workspaces");
chk("list_workspaces friendly 404", /available on this Floorp build/i.test(lw.text), lw.text.slice(0, 80));

if (browserId) await call("close_tab", { browserId });
console.log(`\n${pass} passed, ${fail} failed`);
await client.close();
process.exit(fail ? 1 : 0);
