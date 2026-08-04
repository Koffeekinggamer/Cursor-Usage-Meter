# Cursor Usage Meter

Always-on-top analog needle overlay for **Cursor** plan usage.

**Repo:** https://github.com/Koffeekinggamer/Cursor-Usage-Meter

Independent of the Terminal Grok meter:
https://github.com/Koffeekinggamer/Grok-4.5-Usage-Meter

- Reads the signed-in account from Cursor’s local `state.vscdb` (no manual token paste)
- Polls `https://cursor.com/api/usage-summary`
- Dual needles: **blue = Cursor/Auto models**, **dark = other/API models**
- Frameless, always-on-top gauge you can drag; double-click to refresh
- **Single instance** — a second launch focuses the first and exits
- Optional Watcher starts the Meter when Cursor opens and quits it when Cursor closes

## Requirements

- Node.js 18+
- Cursor installed and signed in
- macOS recommended for auto-launch (Linux autostart supported)

## Install

```bash
git clone https://github.com/Koffeekinggamer/Cursor-Usage-Meter.git
cd Cursor-Usage-Meter
export PATH="$HOME/.local/node/bin:$PATH"   # if needed
npm install
npm test
npm start
```

### Auto-launch when Cursor opens

```bash
npm run install-autolaunch
```

```bash
npm run uninstall-autolaunch
```

## Controls

- Drag the dial to reposition
- Double-click to force a refresh
- Poll interval: `CUM_POLL_MS` (default `60000`)

## Visual proof (Reading → Face)

Automates the Build acceptance check for a non-idle dual-needle Face (numeric Auto/API labels, painted dial — not blank cream):

```bash
npm run verify-meter-ui          # dedicated Electron verify → tmp/meter-verify.png
CUM_SELFTEST=1 npm start         # or: npm run selftest → tmp/meter-selftest.{png,json}
```

Both paths fail closed when labels stay idle em-dashes or the canvas looks unpainted.

## BML skills coach

The optional **BML** button opens a Build–Measure–Learn coach powered by the
Matt skills pack. Pick the target repo from the **project dropdown** in the
BML panel — BML does not follow the active Cursor chat. The dial keeps polling
Cursor usage on its own schedule.

Running a skill writes the complete prompt to
`CUM_COPY_FILE` (or Cursor Usage Meter app data), copies it with `pbcopy` on
macOS, then auto-pastes into Cursor Agent (`⌘⇧V`) and sends it. Grant
**Accessibility** to Cursor Usage Meter (or Terminal/osascript) if paste fails.

After each send, BML waits for Agent activity to go idle, marks the skill done,
and automatically starts the next one. Use **Next now** to skip the wait, or
**Cancel** to stop the chain. Set `CUM_BML_AUTO_CONTINUE=0` for the old
manual Continue gate.

```bash
npm run bml-run-auto          # /ask-matt for the live open chat (no Meter UI required)
CUM_BML_CWD=/path/to/app npm run bml-run-auto   # pin a project
CUM_BML_PASTE=0               # clipboard + activate only (manual ⌘⇧V)
CUM_BML_SEND=0                # paste but do not press Return
CUM_BML_AUTO_CONTINUE=0       # pause for Continue instead of auto-next
CUM_BML_IDLE_MS=12000         # quiet time before treating Agent as done
CUM_BML_SDK=1 npm run bml-run-auto   # optional: Cursor SDK model Auto when configured
npm run bml-live             # inspect persisted BML state / prompts
```

## Domain glossary

See [`CONTEXT.md`](./CONTEXT.md).
