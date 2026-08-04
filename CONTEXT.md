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
chain for a **user-selected project** (dropdown in the BML header). It does not
follow the active Cursor chat. Independent of usage polling and of
Grok-4.5-Usage-Meter. CLI `npm run bml-run-auto` still resolves the live open
chat (or `CUM_BML_CWD`) without opening the Meter UI.

**Cursor inject**:
In the Meter UI, the coach binds to the **dropdown-selected project** (persisted
as `selectedProjectCwd`). Env `CUM_BML_CWD` overrides the selection. The
dropdown lists recent Cursor workspaces plus Meter roots. Pastes still go into
the focused Cursor Agent input (⌘⇧V); only the *experiment repo* is chosen
manually.

It saves each prompt, copies to the clipboard, activates Cursor, pastes into
the Agent input with ⌘⇧V, and sends it. Requires Accessibility for the Meter /
osascript. By default it waits for Agent idle, then auto-starts the next skill
(`CUM_BML_AUTO_CONTINUE=0` restores manual Continue). Optional `CUM_BML_SDK=1`
uses the Cursor SDK when configured.

**Skill roots**:
`CUM_SKILLS_ROOT`, `.cursor/skills`, `.agents/skills`, and `skills` in the
active workspace are preferred, followed by compatible Matt-pack and Grok
skill fallback directories.
