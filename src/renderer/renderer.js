"use strict";

const canvas = document.getElementById("gauge");
const cursorPctEl = document.getElementById("cursorPct");
const otherPctEl = document.getElementById("otherPct");
const planEl = document.getElementById("plan");
const legendEl = document.getElementById("legend");
const legendCursorEl = document.getElementById("legendCursor");
const legendOtherEl = document.getElementById("legendOther");
const shellEl = document.getElementById("shell");
const bmlBtn = document.getElementById("bmlBtn");
const bmlPanel = document.getElementById("bmlPanel");
const bmlChain = document.getElementById("bmlChain");
const bmlCost = document.getElementById("bmlCost");
const bmlCancel = document.getElementById("bmlCancel");
let bml = null;
let bmlBusy = false;

const DIAL = 200;

/** Idle face so the dial paints immediately (never a transparent hole). */
const IDLE_FACE = {
  cursor: {
    percent: 0,
    label: "—",
    targetAngle: -120,
    color: "#2563eb",
    arcColor: "#2563eb",
  },
  other: {
    percent: 0,
    label: "—",
    targetAngle: -120,
    color: "#1c1917",
    arcColor: "#2f6f4e",
  },
  plan: "",
  legend: { cursor: "Auto", other: "API" },
  legendText: "Auto · API",
  titleHint: "Cursor Usage Meter",
  showingLastGood: false,
  hasFault: false,
  account: "",
};

let face = IDLE_FACE;
let cursorNeedle = { angle: -120, velocity: 0 };
let otherNeedle = { angle: -120, velocity: 0 };
let lastTs = performance.now();
/** @type {CanvasRenderingContext2D|null} */
let ctx = null;

function shortenBmlStatus(text) {
  return String(text || "")
    .replace(/\(backup:\s*[^)]+\)/gi, "(saved)")
    .replace(/Cursor activated\.?/gi, "")
    .replace(
      /Paste into Cursor Agent \(⌘V\),?\s*(let Auto finish(?: the skill)?,?\s*)?then click Continue\.?/gi,
      "Paste into Agent (⌘V), then Continue."
    )
    .replace(
      /Paste into Agent \(Auto\),?\s*(wait(?: for the skill to finish)?,?\s*)?then click Continue\.?/gi,
      "Paste into Agent, then Continue."
    )
    .replace(
      /Pause:\s*paste into (?:Cursor )?Agent \(Auto\),?\s*(wait until that skill finishes,?\s*)?then(?: click)? Continue/gi,
      "Pause: paste into Agent, then Continue"
    )
    .replace(/\s+/g, " ")
    .trim();
}

function fillBmlProjectSelect(view) {
  const sel = document.getElementById("bmlProjectSelect");
  if (!sel) return;
  const choices = Array.isArray(view.projectChoices) ? view.projectChoices : [];
  const selected = view.selectedProjectCwd || "";
  const nextValues = choices.map((c) => c.cwd).join("\0");
  if (sel.dataset.choiceKey !== nextValues) {
    sel.dataset.choiceKey = nextValues;
    sel.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a project…";
    sel.appendChild(placeholder);
    for (const c of choices) {
      const opt = document.createElement("option");
      opt.value = c.cwd;
      opt.textContent = c.name || pathBasename(c.cwd);
      sel.appendChild(opt);
    }
  }
  if (sel.value !== selected) sel.value = selected;
}

function pathBasename(p) {
  const s = String(p || "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

function applyBml(view) {
  if (!view) return;
  bml = view;
  bmlPanel.hidden = !view.panelOpen;
  document.body.classList.toggle("bml-open", Boolean(view.panelOpen));
  bmlBtn.classList.toggle("active", Boolean(view.panelOpen));
  bmlBtn.setAttribute("aria-expanded", view.panelOpen ? "true" : "false");
  bmlCancel.hidden = !(bmlBusy || view?.runCost?.running || view?.canCancel);
  const bmlConfirm = document.getElementById("bmlConfirm");
  const bmlRun = document.getElementById("bmlRun");
  const bmlStatus = document.getElementById("bmlStatus");
  const awaiting = Boolean(view.awaitingConfirm);
  if (bmlConfirm) {
    bmlConfirm.hidden = !awaiting;
    bmlConfirm.textContent = view.autoContinue ? "Next now" : "Continue";
    bmlConfirm.title = view.autoContinue
      ? "Skip the idle wait and start the next skill now"
      : "Mark this skill done after Agent finishes, then copy the next";
  }
  if (bmlRun) bmlRun.hidden = awaiting;
  if (bmlStatus) {
    // Hide clipboard fluff; show live auto-continue / error status.
    const raw = view.injectStatus || view.lastInject?.detail || "";
    const isLive =
      /auto-continu|Agent (running|working)|Waiting for Agent|Auto-continued|Chain done/i.test(
        raw
      );
    const text = shortenBmlStatus(
      isLive
        ? raw
        : view.lastError ||
            (view.lastInject?.ok === false ? view.lastInject?.detail : "") ||
            ""
    );
    bmlStatus.hidden = !text;
    bmlStatus.textContent = text;
    bmlStatus.title = text;
  }
  if (bmlChain) {
    bmlChain.innerHTML = "";
    (view.skillChain || []).forEach((step, index) => {
      const li = document.createElement("li");
      li.textContent = step.command || step.label || "";
      li.dataset.stepIndex = String(index);
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      if (step.active) li.classList.add("active");
      if (step.done) li.classList.add("done");
      if (bmlBusy || awaiting) li.setAttribute("aria-disabled", "true");
      bmlChain.appendChild(li);
    });
  }
  if (bmlCost) {
    const cost = String(view.costEstimate || "Est. —")
      .replace(/\s*·\s*Est\.\s*/i, "\nEst. ")
      .replace(/[^\S\n]+/g, " ")
      .trim();
    bmlCost.textContent = cost;
    bmlCost.title = cost.replace(/\n/g, " · ");
  }
  fillBmlProjectSelect(view);
  const measure = view.measure || {};
  document.getElementById("mDuration").checked = Boolean(measure.durationElapsed);
  document.getElementById("mKill").checked = Boolean(measure.killHit);
  const notes = document.getElementById("mNotes");
  notes.innerHTML = "";
  for (const note of measure.weekNotes || []) {
    const li = document.createElement("li");
    li.textContent = `${note.value ? `${note.value} — ` : ""}${note.text}`;
    notes.appendChild(li);
  }
  document.getElementById("bmlMeasureSection").hidden = view.stage !== "Measure";
  document.getElementById("bmlLearnSection").hidden = !["Learn", "Done"].includes(view.stage);
}

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.("#bmlBtn, #bmlPanel, button, input, textarea, a, label, select"));
}

function setupCanvas() {
  if (!canvas) return null;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(DIAL * dpr);
  canvas.height = Math.round(DIAL * dpr);
  canvas.style.width = `${DIAL}px`;
  canvas.style.height = `${DIAL}px`;
  const c = canvas.getContext("2d", { alpha: true });
  if (!c) return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

ctx = setupCanvas();

function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  if (!ctx) ctx = setupCanvas();
  const draw = globalThis.MeterPaint?.drawMeterFace;
  const active = face || IDLE_FACE;

  if (
    draw &&
    canvas &&
    ctx &&
    window.tokenMeter?.stepNeedle &&
    window.tokenMeter?.faceFrame
  ) {
    cursorNeedle = window.tokenMeter.stepNeedle(
      cursorNeedle,
      active.cursor.targetAngle,
      dt
    );
    otherNeedle = window.tokenMeter.stepNeedle(
      otherNeedle,
      active.other.targetAngle,
      dt
    );
    const paintFrame = window.tokenMeter.faceFrame(active, {
      cursor: cursorNeedle.angle,
      other: otherNeedle.angle,
    });
    try {
      draw(ctx, paintFrame, { width: DIAL, height: DIAL });
    } catch (err) {
      console.error("Meter paint failed", err);
    }
  }

  requestAnimationFrame(frame);
}

function applyFace(payload) {
  if (!payload?.cursor || !payload?.other) return;
  face = payload;

  if (payload.hasFault && !payload.showingLastGood) {
    cursorPctEl.textContent = payload.cursor.label;
    otherPctEl.textContent = payload.other.label;
    legendEl.hidden = true;
    planEl.textContent = payload.plan || "";
  } else {
    cursorPctEl.textContent = payload.cursor.label;
    otherPctEl.textContent = payload.other.label;
    legendEl.hidden = false;
    if (legendCursorEl) legendCursorEl.textContent = payload.legend.cursor;
    if (legendOtherEl) legendOtherEl.textContent = payload.legend.other;
    planEl.textContent = payload.plan || "";
  }

  if (shellEl && payload.titleHint) {
    shellEl.title = payload.titleHint;
  }
}

let dragging = false;
let lastX = 0;
let lastY = 0;

window.addEventListener("pointerdown", (e) => {
  if (isInteractiveTarget(e.target)) return;
  if (!Number.isFinite(e.screenX) || !Number.isFinite(e.screenY)) return;
  dragging = true;
  lastX = e.screenX;
  lastY = e.screenY;
  e.target.setPointerCapture?.(e.pointerId);
});

window.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  if (!Number.isFinite(e.screenX) || !Number.isFinite(e.screenY)) return;
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  lastX = e.screenX;
  lastY = e.screenY;
  window.tokenMeter?.dragBy(dx, dy);
});

window.addEventListener("pointerup", () => {
  dragging = false;
});

window.addEventListener("dblclick", (e) => {
  if (isInteractiveTarget(e.target)) return;
  window.tokenMeter?.refresh()?.then((f) => f && applyFace(f));
});

function bmlApi() { return window.tokenMeter?.bml; }
async function runSingleSkill(index) {
  if (bmlBusy) return;
  bmlBusy = true;
  try { applyBml(await bmlApi()?.runOneSkillStep(index)); }
  finally { bmlBusy = false; }
}
bmlBtn?.addEventListener("click", async (e) => { e.stopPropagation(); applyBml(await bmlApi()?.togglePanel()); });
document.getElementById("bmlProjectSelect")?.addEventListener("change", async (e) => {
  e.stopPropagation();
  const cwd = e.target.value || null;
  try {
    applyBml(await bmlApi()?.setSelectedProject(cwd));
  } catch {
    // ignore
  }
});
bmlChain?.addEventListener("click", (e) => {
  const li = e.target?.closest?.("li[data-step-index]");
  if (li && li.getAttribute("aria-disabled") !== "true") runSingleSkill(Number(li.dataset.stepIndex));
});
document.getElementById("bmlRun")?.addEventListener("click", async () => {
  if (bmlBusy) return; bmlBusy = true;
  try { applyBml(await bmlApi()?.runSkillStep()); } finally { bmlBusy = false; }
});
document.getElementById("bmlConfirm")?.addEventListener("click", async () => {
  if (bmlBusy) return;
  bmlBusy = true;
  try {
    applyBml(await bmlApi()?.confirmInjectedStep({ continueChain: true }));
  } finally {
    bmlBusy = false;
  }
});
bmlCancel?.addEventListener("click", async () => applyBml(await bmlApi()?.cancel()));
document.getElementById("mDuration")?.addEventListener("change", async (e) => applyBml(await bmlApi()?.setMeasureFlags({ durationElapsed: e.target.checked })));
document.getElementById("mKill")?.addEventListener("change", async (e) => applyBml(await bmlApi()?.setMeasureFlags({ killHit: e.target.checked })));
document.getElementById("bmlPostMeasure")?.addEventListener("click", async () => applyBml(await bmlApi()?.postMeasure({ text: document.getElementById("mText").value, value: document.getElementById("mValue").value })));
for (const btn of document.querySelectorAll("[data-learn]")) btn.addEventListener("click", async () => applyBml(await bmlApi()?.recordLearn({ decision: btn.dataset.learn, evidence: document.getElementById("learnEvidence").value })));
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && bml?.panelOpen) bmlApi()?.setPanelOpen(false).then(applyBml); });

window.tokenMeter?.onFaceUpdate?.(applyFace);
window.tokenMeter?.getFace?.().then((payload) => {
  if (payload) applyFace(payload);
});
window.tokenMeter?.bml?.onState?.(applyBml);
window.tokenMeter?.bml?.getState?.().then(applyBml);
requestAnimationFrame(frame);
