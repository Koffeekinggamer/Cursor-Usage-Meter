# Token Usage Meter

Always-on-top analog needle overlay for your Cursor plan usage.

**Repo:** https://github.com/Koffeekinggamer/Token-Usage-Meter

- Reads the signed-in account from Cursor’s local `state.vscdb` (no manual token paste)
- Polls `https://cursor.com/api/usage-summary`
- Dual needles: **blue = Cursor/Auto models**, **dark = other/API models**
- Frameless, always-on-top gauge you can drag; double-click to refresh
- Optional Watcher auto-launches the Meter whenever Cursor is open

## Requirements

- Node.js 18+
- Cursor installed and signed in
- macOS recommended for auto-launch (Linux autostart supported; Windows: run the Watcher manually)

## Install (other machines / other users)

```bash
git clone https://github.com/Koffeekinggamer/Token-Usage-Meter.git
cd Token-Usage-Meter
npm install
npm test
npm start
```

### Auto-launch when Cursor opens

```bash
npm run install-autolaunch
```

This installs a macOS LaunchAgent (or Linux autostart entry) that runs `scripts/watch-cursor.js`. The Watcher starts the Meter when Cursor opens and **quits the Meter when Cursor closes**. It uses System Events to detect Cursor, spawns the real Electron binary (not the npm shim), and relies on `.meter.pid` so it won’t double-launch.

```bash
npm run uninstall-autolaunch
```

On Windows, keep the Watcher running in a terminal:

```bash
npm run watch-cursor
```

## How auth works

| OS | `state.vscdb` |
|---|---|
| macOS | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
| Windows | `%APPDATA%\Cursor\User\globalStorage\state.vscdb` |
| Linux | `~/.config/Cursor/User/globalStorage/state.vscdb` |

Override with `CURSOR_STATE_DB=/path/to/state.vscdb` if needed.

The app copies the DB to a temp file (avoids WAL locks), reads `cursorAuth/accessToken`, builds the `WorkosCursorSessionToken` cookie from the JWT `sub`, and calls Cursor’s usage API. The token is never written to disk by this app.

## Controls

- Drag the dial to reposition
- Double-click to force a refresh
- Poll interval: `TUM_POLL_MS` (default `60000`)

## Reliability

- **Reading** — `src/lib/reading.js` (signed-in account → plan usage)
- **Meter state** — `src/lib/meter-state.js` (last-good reading + fault)
- **Face DTO / copy** — `src/lib/face.js` + `src/lib/face-copy.js` (single IPC shape; Auto/API wording)
- **Paint** — `src/renderer/paint.js` (`drawMeterFace` in the renderer; canvas ctx cannot cross contextBridge)
- **Physics** — `src/lib/gauge.js` `stepNeedle` via preload (plain data only)
- **Watcher** — `src/lib/watcher.js` (`syncMeterWithCursor` — start on open, stop on close)

## Domain glossary

See [`CONTEXT.md`](./CONTEXT.md) for Meter / Reading / Fault vocabulary used by agents and contributors.
