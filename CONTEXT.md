# Token Usage Meter

An always-on-top overlay that shows the signed-in Cursor plan's included usage as a dual-needle analog dial.

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
The share of the signed-in account's included Cursor plan allowance already consumed in the current billing cycle, expressed as a percent (and as the two needle percents above).
_Avoid_: Token count, spend, on-demand, team pool, request count

**Reading**:
A single successful snapshot of plan usage taken from Cursor's usage API for the signed-in account.
_Avoid_: Sample, poll result, metric

**Signed-in account**:
The Cursor identity currently authenticated in the local Cursor app, discovered only via `state.vscdb`.
_Avoid_: Manual token, browser cookie, API key, login form

**Last-good reading**:
The most recent successful reading still shown on the Meter when a later refresh fails.
_Avoid_: Cache, stale data (as a product feature name)

**Fault state**:
A visible indication that the Meter cannot produce a fresh reading (missing sign-in, API failure, missing database).
_Avoid_: Crash, error toast, dialog

**Watcher**:
The background process that starts the Meter when the Cursor app opens and stops the Meter when Cursor closes.
_Avoid_: Autostart service, daemon, LaunchAgent (implementation detail)
