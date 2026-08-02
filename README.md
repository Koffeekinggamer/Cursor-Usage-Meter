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

## Domain glossary

See [`CONTEXT.md`](./CONTEXT.md).
