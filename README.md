# floorp-mcp

> An **MCP (Model Context Protocol)** server that lets AI assistants — Claude Code,
> Claude Desktop, Cursor, and any MCP client — **read pages, take screenshots and
> manage tabs** in the [Floorp](https://floorp.app) browser, using your real,
> logged-in browsing session.

Think "Claude in Chrome", but for Floorp (and other Firefox-based browsers on the
roadmap).

## How it works

Floorp ships a **built-in local automation server**. When you set
`floorp.mcp.enabled = true` in `about:config`, Floorp exposes an HTTP API on
`http://127.0.0.1:58261`. This project is a thin, well-documented MCP bridge that
translates MCP tool calls into requests against that API — **no browser extension
required**.

```
  Claude Code / Desktop / Cursor
            │  MCP (stdio)
            ▼
      floorp-mcp  ──HTTP──►  Floorp :58261  ──►  your real tabs
   (this project)            (built-in API)
```

## Requirements

- **Floorp** installed and running.
- In `about:config`, set **`floorp.mcp.enabled`** to `true`, then fully restart Floorp.
- **Node.js** ≥ 18.

## Setup

```bash
git clone https://github.com/Frumane/floorp-mcp
cd floorp-mcp
npm install
npm run build
```

Register it with Claude Code (user-wide):

```bash
claude mcp add floorp -s user -- node /absolute/path/to/floorp-mcp/dist/index.js
```

…or add it to your MCP config manually:

```json
{
  "mcpServers": {
    "floorp": {
      "command": "node",
      "args": ["/absolute/path/to/floorp-mcp/dist/index.js"]
    }
  }
}
```

## Tools

**Tabs & reading**

| Tool | What it does |
|------|--------------|
| `list_tabs` | List all open tabs (title, URL, browserId, active, pinned). |
| `open_tab` | Open a new tab at a URL; **returns the new tab's `browserId`** so you can target it. |
| `get_active_tab` | Return the active tab's title, URL and browserId. |
| `navigate_tab` | Navigate an existing tab to a URL. |
| `close_tab` | Close a tab. |
| `read_page` | Read a tab's content as clean Markdown (or HTML / accessibility tree). |
| `snapshot` | Structured page map: Markdown with inline `fp:` refs + an element selector map — locate elements without grepping HTML, then act via a `ref`. |
| `screenshot` | Capture a screenshot of a tab (viewport or full page). |
| `launch_floorp` | Ensure Floorp is running — launches it if the API isn't reachable (Windows). |

**Interaction**

| Tool | What it does |
|------|--------------|
| `click` | Click an element by CSS selector **or a `ref` from `snapshot`**; auto-scrolls it into view first. |
| `type_text` | Type into an input/textarea — or a rich/contenteditable editor (Slate, ProseMirror…) — by CSS selector. |
| `fill_form` | Fill multiple fields at once. |
| `press_key` | Press a keyboard key (Enter, Tab, …). |
| `wait_for_element` | Wait for an element to attach / become visible / etc. |
| `get_value` | Read the current value of an input/textarea/select. |

Most tools target the **active tab** by default; pass a `browserId` (from
`list_tabs`) to target a specific tab.

**Real OS keyboard (Windows)** — for React/rich editors and bot-guarded submits
that ignore synthetic input:

| Tool | What it does |
|------|--------------|
| `real_type` | Type into the focused element via **genuine OS key events** (`isTrusted`). |
| `real_key` | Press a real key/combo, e.g. `"Enter"`, `"ctrl+a"`. |
| `real_clear` | Real Ctrl+A + Delete — reliably clears a rich/contenteditable field. |

These produce input a page can't distinguish from a human's, so they drive
React/Slate editors and submit composers that synthetic clicks/typing can't.
Workflow: `click` the field to focus it → `real_clear` / `real_type` / `real_key "Enter"`.

> **Safety guard:** OS keystrokes go to the foreground window, so before sending
> anything these tools bring Floorp to the foreground and **verify** it — if Floorp
> isn't running or can't be focused, they **abort without typing a single key**, so
> input can never leak into another app.

## Security

The Floorp automation API listens on `127.0.0.1` with **no authentication by
default**, so any local process can drive your browser while it's enabled. Only
enable `floorp.mcp.enabled` when you intend to use it, and treat page content the
assistant reads as untrusted input.

**More interaction & queries**

| Tool | What it does |
|------|--------------|
| `hover` / `double_click` / `right_click` | Mouse gestures on an element (selector or `ref`). |
| `select_option` | Choose an option in a `<select>`. |
| `set_checked` | Check/uncheck a checkbox or radio. |
| `submit_form` | Submit a form. |
| `upload_file` | Set a file `<input>` by absolute path. |
| `get_attribute` | Read an element attribute (href, value, …). |
| `get_article` | Readability-extracted main article as Markdown. |
| `get_cookies` | Cookies visible to the page. |
| `wait_for_network_idle` | Wait for network activity to settle. |
| `list_workspaces` / `switch_workspace` | Floorp workspaces (where supported). |

## Notes & limitations

Learned from driving real apps (incl. Google Flow):

- **Rich editors:** `type_text` handles plain inputs *and* contenteditable editors
  (Slate, ProseMirror, Lexical) — it falls back to dispatching a real text-input
  event when an element has no `.value`. Reliably *clearing* such editors isn't
  solved yet (no `select-all`/`evaluate`).
- **Submitting React composers:** many chat/prompt composers submit on a real
  **Enter keydown**, not on a synthetic click of the send button. Prefer
  `press_key` `"Enter"` over `click` for those.
- **Trusted events:** you cannot forge `isTrusted=true` from page JavaScript — it
  is a browser security invariant. Floorp injects input at a privileged layer, so
  ordinary clicks/keys behave like real ones; but flows guarded by reCAPTCHA or
  strict bot-detection may still refuse automated submission.
- **`evaluate`:** the page-JS eval endpoint returns HTTP 404 on some Floorp builds,
  so it is not exposed as a tool here.
- **Multiple windows:** when more than one window is open, the "active tab" is
  ambiguous (each window has its own active tab). Prefer the `browserId` returned
  by `open_tab`, or one from `list_tabs`, and pass it explicitly to every tool.

## Roadmap

- [x] Tab management, page reading, screenshots
- [x] Interaction tools: click, type, fill forms, key presses, read field values
- [x] Real OS keyboard (Windows): `real_type` / `real_key` / `real_clear`, with a
      foreground safety guard — drives React/Slate editors & bot-guarded submits
- [x] `snapshot` (fingerprint refs + selector map) + `click` by `ref` + auto-scroll-into-view
- [x] `launch_floorp` — start Floorp if not running (Windows)
- [x] Extra tools: hover, double/right-click, select_option, set_checked, submit,
      upload_file, get_attribute, get_article, get_cookies, wait_for_network_idle, workspaces
- [ ] Real OS mouse (coordinate-calibrated click) — cross-DPI screen mapping
- [ ] macOS / Linux native-input backends
- [ ] JS `evaluate` (available in newer Floorp builds; older ones return HTTP 404)
- [ ] Optional bearer-token auth
- [ ] Support for other Firefox-based browsers (WebDriver BiDi fallback)

## Acknowledgements

Built against the automation API exposed by Floorp. The official
[`Floorp-Projects/floorp-mcp-server`](https://github.com/Floorp-Projects/floorp-mcp-server)
was a useful reference for mapping the endpoint surface. This is an independent,
clean-room MIT-licensed implementation.

## License

[MIT](./LICENSE) © Arda Karaman
