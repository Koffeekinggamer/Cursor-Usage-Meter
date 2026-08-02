# Cursor Usage Meter

An always-on-top overlay that shows the signed-in Cursor plan's included usage as a dual-needle analog dial.

**Cursor-only.** Terminal Grok has a separate app: https://github.com/Koffeekinggamer/Grok-4.5-Usage-Meter

## Language

**Meter**:
The always-on-top overlay window that displays plan usage as two analog needles.
_Avoid_: Widget, HUD, dashboard, gauge app

**Cursor models usage**:
The Auto / Cursor-model share of included plan allowance (`autoPercentUsed`), shown on the blue needle.
_Avoid_: Total usage, API usage

**Other models usage**:
The named / API-model share of included plan allowance (`apiPercentUsed`), shown on the dark needle.
_Avoid_: On-demand, team pool

**Plan usage**:
The share of the signed-in account's included Cursor plan allowance already consumed in the current billing cycle.
_Avoid_: Token count, spend, on-demand, team pool, request count

**Reading**:
A single successful snapshot of plan usage from Cursor's usage API for the signed-in account.
_Avoid_: Sample, poll result, metric

**Signed-in account**:
The Cursor identity authenticated in the local Cursor app, discovered only via `state.vscdb`.
_Avoid_: Manual token, browser cookie, API key, login form

**Last-good reading**:
The most recent successful reading still shown when a later refresh fails.
_Avoid_: Cache, stale data (as a product feature name)

**Fault state**:
A visible indication that the Meter cannot produce a fresh reading.
_Avoid_: Crash, error toast, dialog

**Watcher**:
The background process that starts the Meter when Cursor opens and stops it when Cursor closes.
_Avoid_: Autostart service, daemon, LaunchAgent (implementation detail)

## BML skills coach

**BML coach**:
The optional Meter panel that organizes Matt skills into a Build–Measure–Learn
chain for the active Cursor workspace. It is independent of
Grok-4.5-Usage-Meter.

**Cursor inject**:
The coach saves each prompt in Cursor Usage Meter app data (or
`CUM_COPY_FILE`), copies it to the macOS clipboard, and may activate Cursor.
The operator pastes it into Cursor Agent with ⌘V; there is no Cursor CLI
automation path.

**Skill roots**:
`CUM_SKILLS_ROOT`, `.cursor/skills`, `.agents/skills`, and `skills` in the
active workspace are preferred, followed by compatible Matt-pack and Grok
skill fallback directories.
