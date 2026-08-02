"use strict";

/**
 * Main-process BML coach: state persistence + github + inject orchestration.
 */

const {
  emptyBmlState,
  defaultStatePath,
  loadBmlState,
  saveBmlState,
  reduceBmlState,
} = require("./state");
const {
  SKILL_CHAIN,
  stepAt,
  nextStepIndex,
  canSkipStep,
  tinyImplementIndex,
  buildSkillPrompt,
  isMeasureAllowedCommand,
  buildMeasureInstrumentPrompt,
  resolveChainForView,
  estimateChainCost,
  formatCostEstimate,
  formatDuration,
  formatTokens,
  estimateTokensFromText,
  EST_TOKENS_PER_SKILL,
} = require("./skill-chain");
const { canAdvanceStage, nextStage, WIP_LIMIT } = require("./gates");
const { formatTicketBody, EMPTY_FIELDS, validateBacklogReady } = require("./template");
const { injectIntoCursor, abortActiveInject } = require("./inject");
const { createGithubClient } = require("./github");
const {
  loadActiveProjectContext,
  formatProjectContextForPrompt,
  synthesizeTicketFromProject,
} = require("./project-context");
const { writePromptLog } = require("./prompt-log");

/**
 * @param {{
 *   statePath?: string,
 *   appData?: string,
 *   github?: ReturnType<typeof createGithubClient>,
 *   inject?: typeof injectIntoCursor,
 * }} [opts]
 */
function createBmlCoach(opts = {}) {
  const statePath =
    opts.statePath ||
    defaultStatePath({
      appData: opts.appData,
      env: process.env,
    });
  let state = loadBmlState(statePath);
  const github = opts.github || createGithubClient();
  const inject = opts.inject || injectIntoCursor;
  /** Cooperative cancel for chain + single-skill runs (and kills active inject). */
  let cancelRequested = false;

  function persist() {
    try {
      saveBmlState(statePath, state);
    } catch {
      // best effort
    }
  }

  function dispatch(action) {
    state = reduceBmlState(state, action);
    persist();
    return getView();
  }

  function gateContext() {
    return {
      stage: state.stage,
      fields: state.fields,
      hasExperimentLabel: true,
      wipActive: state.wipActive ?? 0,
      smallestTestShipped: state.build.smallestTestShipped,
      measurePathNamed: state.build.measurePathNamed,
      weeklyNumbersPosted: state.measure.weekNotes.length > 0,
      durationElapsed: state.measure.durationElapsed,
      killHit: state.measure.killHit,
      decisionLabel: state.learn.decisionLabel,
      evidenceWritten: state.learn.evidenceWritten,
    };
  }

  function activeProject() {
    return loadActiveProjectContext({
      preferCwd: process.env.CUM_BML_CWD || process.env.GUM_BML_CWD || null,
    });
  }

  /**
   * The active chat project IS the experiment. Bind issue + synthesize
   * Build/Measure from that repo whenever the chat project changes.
   * Mutates `state` via reduce (no dispatch) to avoid getView recursion.
   */
  function ensureExperimentFromChatProject() {
    let project;
    try {
      project = activeProject();
    } catch {
      return null;
    }
    if (!project?.cwd) return project;

    const title = `BML: ${project.name || project.cwd}`;
    const cwdKey = project.cwd;
    const sameProject =
      state.activeIssue &&
      (state.activeIssue.title === title ||
        state.activeIssue.repo === cwdKey ||
        (state.fields?.technicalContext || "").includes(cwdKey));

    if (!sameProject || !state.activeIssue) {
      const fields = synthesizeTicketFromProject(project);
      state = reduceBmlState(state, {
        type: "experiment/set",
        issue: {
          number: 0,
          url: "",
          title,
          repo: cwdKey,
          itemId: null,
        },
        stage: state.stage === "Done" ? "Backlog" : state.stage,
        fields,
      });
      state = reduceBmlState(state, {
        type: "build/flags",
        measurePathNamed: true,
      });
      persist();
    } else if (!state.fields || !String(state.fields.hypothesis || "").trim()) {
      state = reduceBmlState(state, {
        type: "fields/set",
        fields: synthesizeTicketFromProject(project),
      });
      persist();
    }

    return project;
  }

  function getView() {
    const project = ensureExperimentFromChatProject();
    const step = stepAt(state.buildStepIndex);
    const nxt = nextStage(state.stage);
    const advanceCheck = nxt
      ? canAdvanceStage(state.stage, nxt, gateContext())
      : { ok: false, errors: ["Already Done."] };

    const chain = resolveChainForView();
    const pre = estimateChainCost({ fromIndex: 0 });
    const rc = state.runCost || {};
    // Wall-clock for the whole run (live from startedAt, not per-skill)
    let liveElapsedMs = rc.elapsedMs || 0;
    if (rc.running && rc.startedAt) {
      liveElapsedMs = Math.max(liveElapsedMs, Date.now() - rc.startedAt);
    }
    let costLabel = pre.label;
    if (rc.running) {
      const tok = (rc.tokensIn || 0) + (rc.tokensOutEst || 0);
      costLabel = formatCostEstimate({
        running: true,
        stepIndex: Math.min(rc.step || 0, rc.total || SKILL_CHAIN.length),
        steps: rc.total || SKILL_CHAIN.length,
        seconds: liveElapsedMs / 1000,
        tokens: tok,
      });
    } else if (rc.lastDurationMs != null && rc.lastTokensEst != null) {
      costLabel = `Last ${formatDuration(rc.lastDurationMs / 1000)} · ~${formatTokens(rc.lastTokensEst)}  ·  Est. ${pre.label}`;
    } else {
      costLabel = `Est. ${pre.label}`;
    }

    return {
      ...state,
      skillChain: chain.map((s, i) => ({
        ...s,
        // buildStepIndex points at current step while running; after a step
        // finishes the coach advances index so completed rows get done=true
        active:
          i === state.buildStepIndex &&
          state.buildStepIndex < SKILL_CHAIN.length,
        done: i < state.buildStepIndex,
      })),
      currentStep: step
        ? {
            ...step,
            ...(chain.find((c) => c.id === step.id) || {}),
          }
        : null,
      canSkipCurrent: canSkipStep(state.buildStepIndex),
      nextStage: nxt,
      canAdvance: advanceCheck.ok,
      advanceErrors: advanceCheck.ok ? [] : advanceCheck.errors,
      wipLimit: WIP_LIMIT,
      emptyFields: { ...EMPTY_FIELDS },
      costEstimate: costLabel,
      costEstimateDetail: pre,
      liveElapsedMs: rc.running ? liveElapsedMs : rc.lastDurationMs || 0,
      canCancel: Boolean(rc.running) || cancelRequested,
      cancelRequested,
      jobBrief:
        state.fields?.hypothesis ||
        state.activeIssue?.title ||
        project?.name ||
        null,
      project: project
        ? {
            cwd: project.cwd,
            name: project.name,
            sessionId: project.sessionId,
            sessionLive: project.sessionLive,
            sessionSource: project.sessionSource,
            boundToChat: project.boundToChat,
            buildNatures: project.buildNatures,
            measureNatures: project.measureNatures,
            technicalHints: project.technicalHints,
            hasContextMd: Boolean(project.contextExcerpt),
            scripts: project.scripts,
          }
        : null,
    };
  }

  function projectPromptBlock() {
    try {
      return formatProjectContextForPrompt(activeProject());
    } catch {
      return "";
    }
  }

  /**
   * Stop the current BML run (chain or single skill), kill in-flight inject,
   * and fully reset strikethroughs, process status, and timers.
   */
  function cancelRun() {
    cancelRequested = true;
    try {
      abortActiveInject();
    } catch {
      // ignore
    }
    // Wipe progress (strikethroughs), inject/prompt state, and all timers
    dispatch({ type: "run/reset" });
    return getView();
  }

  return {
    getView,
    getState: () => state,
    cancelRun,

    setPanelOpen(open) {
      return dispatch({ type: open ? "panel/open" : "panel/close" });
    },

    togglePanel() {
      return dispatch({ type: "panel/toggle" });
    },

    setFields(fields) {
      return dispatch({ type: "fields/set", fields });
    },

    setBuildFlags(flags) {
      return dispatch({ type: "build/flags", ...flags });
    },

    setMeasureFlags(flags) {
      return dispatch({ type: "measure/flags", ...flags });
    },

    setTinyBuild() {
      return dispatch({ type: "build/tiny" });
    },

    setStep(index) {
      return dispatch({ type: "build/step", index });
    },

    nextSkillStep() {
      const idx = nextStepIndex(state.buildStepIndex, {
        tinyBuild: state.tinyBuild,
      });
      return dispatch({ type: "build/step", index: idx });
    },

    skipOptionalStep() {
      if (!canSkipStep(state.buildStepIndex)) {
        return dispatch({
          type: "error",
          message: "This step is required unless you enable Tiny build.",
        });
      }
      return this.nextSkillStep();
    },

    async refreshBoard() {
      try {
        const listed = await github.listProjectItems();
        if (!listed.ok) {
          return dispatch({
            type: "error",
            message: listed.error || "Could not list project items.",
          });
        }
        const wip = github.countWip(listed.items);
        dispatch({ type: "wip/set", wipActive: wip });
        dispatch({ type: "error", message: null });
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async createExperiment(fields) {
      try {
        const ready = validateBacklogReady(fields);
        if (!ready.ok) {
          return dispatch({
            type: "error",
            message: ready.errors.join(" "),
          });
        }
        const issue = await github.createExperiment(fields);
        dispatch({
          type: "experiment/set",
          issue: {
            number: issue.number,
            url: issue.url,
            title: issue.title,
            repo: issue.repo,
            itemId: issue.itemId,
          },
          stage: "Backlog",
          fields,
        });
        if (issue.projectError) {
          dispatch({
            type: "error",
            message: `Issue created, but project add failed: ${issue.projectError}`,
          });
        } else {
          dispatch({ type: "error", message: null });
        }
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async selectExperiment(issueRef) {
      try {
        const data = await github.fetchIssueFields(issueRef);
        dispatch({
          type: "experiment/set",
          issue: {
            number: data.number,
            url: data.url,
            title: data.title,
            repo: data.repo,
          },
          stage: state.stage,
          fields: data.fields,
        });
        dispatch({ type: "error", message: null });
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    /**
     * Advance the BML stage — primary way to put AI-generated Build/Measure
     * into practice (no separate GitHub create).
     *
     * Backlog → Build: validates ticket fields, commits them as the local
     * experiment, moves to Build, then auto-runs the Matt skill chain.
     *
     * @param {{
     *   fields?: import('./template').TicketFields|null,
     *   onProgress?: (view: object) => void,
     *   skipChain?: boolean,
     * }} [opts]
     */
    async advanceStage(opts = {}) {
      if (opts.fields) {
        dispatch({ type: "fields/set", fields: opts.fields });
      }

      const nxt = nextStage(state.stage);
      if (!nxt) {
        return dispatch({ type: "error", message: "Already Done." });
      }

      // Active chat project = experiment. Synthesize ticket if needed, then Build.
      if (state.stage === "Backlog" && nxt === "Build") {
        ensureExperimentFromChatProject();
        let fields = opts.fields || state.fields;
        if (!fields || !validateBacklogReady(fields).ok) {
          const project = activeProject();
          fields = synthesizeTicketFromProject(project);
          dispatch({ type: "fields/set", fields });
        }
        const ready = validateBacklogReady(fields || {});
        if (!ready.ok) {
          return dispatch({
            type: "error",
            message: ready.errors.join(" "),
          });
        }

        const project = activeProject();
        const title = `BML: ${project.name || project.cwd}`;
        dispatch({
          type: "experiment/set",
          issue: {
            number: 0,
            url: "",
            title,
            repo: project.cwd || "",
            itemId: null,
          },
          stage: "Backlog",
          fields,
        });

        const check = canAdvanceStage("Backlog", "Build", {
          ...gateContext(),
          fields,
          hasExperimentLabel: true,
        });
        if (!check.ok) {
          return dispatch({
            type: "error",
            message: check.errors.join(" "),
          });
        }

        dispatch({ type: "stage/set", stage: "Build" });
        dispatch({ type: "build/step", index: 0 });
        dispatch({
          type: "build/flags",
          measurePathNamed: true,
        });
        dispatch({ type: "error", message: null });

        if (!opts.skipChain) {
          return this.runAllSkillSteps({
            onProgress: opts.onProgress,
          });
        }
        return getView();
      }

      const check = canAdvanceStage(state.stage, nxt, gateContext());
      if (!check.ok) {
        return dispatch({
          type: "error",
          message: check.errors.join(" "),
        });
      }
      dispatch({ type: "stage/set", stage: nxt });
      dispatch({ type: "error", message: null });
      return getView();
    },

    /**
     * Run a single skill at `index` (defaults to current buildStepIndex).
     * @param {number} [index]
     * @param {{ trackCost?: boolean, onProgress?: (view: object) => void }} [opts]
     */
    async runSkillStep(index, opts = {}) {
      const i =
        Number.isInteger(index) && index >= 0
          ? index
          : state.buildStepIndex;
      const trackCost = opts.trackCost !== false;
      const onProgress =
        typeof opts.onProgress === "function" ? opts.onProgress : null;
      // When chain already owns running, do not re-open solo cost accounting
      const solo = !state.runCost?.running && trackCost;
      if (solo) cancelRequested = false;
      const startedAt = solo ? Date.now() : state.runCost?.startedAt || Date.now();

      if (cancelRequested) {
        return getView();
      }

      dispatch({ type: "build/step", index: i });
      if (solo) {
        dispatch({
          type: "run/cost",
          patch: {
            running: true,
            step: i + 1,
            total: SKILL_CHAIN.length,
            startedAt,
            elapsedMs: 0,
            tokensIn: 0,
            tokensOutEst: 0,
          },
        });
        if (onProgress) onProgress(getView());
      }

      const project = activeProject();
      const preferCwd =
        process.env.CUM_BML_CWD || process.env.GUM_BML_CWD || project.cwd || process.cwd();
      const projectBlock = formatProjectContextForPrompt(project);
      const body = state.fields ? formatTicketBody(state.fields) : null;
      const jobBrief = [
        state.activeIssue?.title,
        state.fields?.hypothesis,
        state.fields?.build,
      ]
        .filter(Boolean)
        .join(" — ");

      const step = stepAt(i) || stepAt(0);
      const chainPos = `Chain step ${i + 1}/${SKILL_CHAIN.length}: ${step?.command || "?"}`;

      try {
        if (cancelRequested) {
          return finishSolo({ cancelled: true });
        }
        if (state.stage === "Measure") {
          const cmd = step?.command || "/implement";
          if (!isMeasureAllowedCommand(cmd) && !state.tinyBuild) {
            const built = buildMeasureInstrumentPrompt({
              issueUrl: state.activeIssue?.url,
              metricLine: state.fields?.measure,
              jobBrief,
            });
            const prompt = [
              built.prompt,
              "",
              projectBlock,
              "",
              "MEASURE: only collect pre-registered metrics for THIS project.",
              chainPos,
            ].join("\n");
            await this._inject(prompt, {
              skillPath: built.skillPath,
              skillOk: built.skillOk,
              preferCwd,
              chainPos,
              stepIndex: i,
              command: step?.command,
              label: step?.label,
            });
            return finishSolo({
              cancelled: cancelRequested || state.lastInject?.method === "cancel",
            });
          }
        }

        const built = buildSkillPrompt(step, {
          issueUrl: state.activeIssue?.url,
          issueTitle: state.activeIssue?.title,
          bodyExcerpt: body,
          stage: state.stage,
          jobBrief,
          cwd: preferCwd,
          projectBlock,
          extra: [
            chainPos,
            "You are one step in an admin carte-blanche BML skill run. Complete THIS skill fully before stopping.",
            "Do not skip ahead to later chain steps — the coach will invoke those next when auto-running.",
            "Act with full authority to finish the work; prefer decisive implementation over asking permission.",
          ].join("\n"),
        });
        if (!built.skillOk) {
          dispatch({
            type: "error",
            message:
              built.skillError ||
              "Matt skill SKILL.md not found — inject will still try slash command.",
          });
        }
        if (cancelRequested) {
          return finishSolo({ cancelled: true });
        }
        await this._inject(built.prompt, {
          skillPath: built.skillPath,
          skillOk: built.skillOk,
          preferCwd,
          chainPos,
          stepIndex: i,
          command: step?.command,
          label: step?.label,
        });
      } catch (err) {
        if (!cancelRequested) {
          dispatch({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return finishSolo({
        cancelled:
          cancelRequested ||
          state.lastInject?.method === "cancel" ||
          /cancell?ed/i.test(String(state.lastInject?.detail || "")),
      });

      /**
       * @param {{ cancelled?: boolean }} [fin]
       */
      function finishSolo(fin = {}) {
        if (solo) {
          const cancelled = Boolean(fin.cancelled);
          if (cancelled) {
            // Full reset: no strikethroughs, no timers, clean process
            dispatch({ type: "run/reset" });
          } else {
            const durationMs = Date.now() - startedAt;
            const inTok = estimateTokensFromText(
              state.lastPrompt?.preview || ""
            );
            dispatch({
              type: "run/cost",
              patch: {
                running: false,
                step: i + 1,
                total: SKILL_CHAIN.length,
                startedAt: null,
                elapsedMs: durationMs,
                tokensIn: inTok,
                tokensOutEst: Math.round(EST_TOKENS_PER_SKILL * 0.55),
                lastDurationMs: durationMs,
                lastTokensEst: inTok + Math.round(EST_TOKENS_PER_SKILL * 0.55),
              },
            });
            if (state.lastInject?.ok) {
              // Mark this skill done if inject succeeded
              dispatch({ type: "build/step", index: i + 1 });
            }
          }
          cancelRequested = false;
          if (onProgress) onProgress(getView());
        }
        return getView();
      }
    },

    /**
     * Bind active chat project as experiment, then auto-run every Matt skill
     * in order (1…N). Publishes progress via onProgress after each step.
     * @param {{ onProgress?: (view: object) => void }} [opts]
     */
    async runAllSkillSteps(opts = {}) {
      const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
      cancelRequested = false;

      // Active chat project = experiment; synthesize Build/Measure from that repo
      ensureExperimentFromChatProject();
      const project = activeProject();
      const fields =
        state.fields && validateBacklogReady(state.fields).ok
          ? state.fields
          : synthesizeTicketFromProject(project);
      dispatch({ type: "fields/set", fields });
      dispatch({
        type: "experiment/set",
        issue: {
          number: 0,
          url: "",
          title: `BML: ${project.name || project.cwd}`,
          repo: project.cwd || "",
          itemId: null,
        },
        stage: "Build",
        fields,
      });
      dispatch({ type: "stage/set", stage: "Build" });
      dispatch({ type: "build/flags", measurePathNamed: true });
      // Always full chain (no tiny-build shortcut)
      state = reduceBmlState(state, {
        type: "build/step",
        index: 0,
      });
      // Clear tiny flag if set
      if (state.tinyBuild) {
        state = { ...state, tinyBuild: false };
        persist();
      }

      const start = 0;
      const last = SKILL_CHAIN.length - 1;
      const startedAt = Date.now();
      let tokensIn = 0;
      let tokensOutEst = 0;
      let cancelled = false;

      // Clear prior strikethrough so progress starts fresh
      dispatch({ type: "build/step", index: 0 });
      dispatch({ type: "error", message: null });
      dispatch({
        type: "run/cost",
        patch: {
          running: true,
          step: 0,
          total: SKILL_CHAIN.length,
          startedAt,
          elapsedMs: 0,
          tokensIn: 0,
          tokensOutEst: 0,
        },
      });
      dispatch({
        type: "inject/result",
        ok: true,
        method: "chain",
        detail: `Auto-running all ${SKILL_CHAIN.length} Matt skills on ${project.name || project.cwd}…`,
      });
      if (onProgress) onProgress(getView());

      /** @type {{ index: number, command: string, ok: boolean }[]} */
      const results = [];

      for (let i = start; i <= last; i++) {
        if (cancelRequested) {
          cancelled = true;
          break;
        }
        // Active = current skill (not yet struck)
        dispatch({ type: "build/step", index: i });
        dispatch({
          type: "run/cost",
          patch: {
            running: true,
            step: i + 1,
            total: SKILL_CHAIN.length,
            startedAt,
            elapsedMs: Date.now() - startedAt,
            tokensIn,
            tokensOutEst,
          },
        });
        if (onProgress) onProgress(getView());

        try {
          // Estimate tokens from the prompt we are about to inject
          const projectBlock = formatProjectContextForPrompt(project);
          const body = state.fields ? formatTicketBody(state.fields) : null;
          const preview = buildSkillPrompt(stepAt(i) || stepAt(0), {
            issueUrl: state.activeIssue?.url,
            issueTitle: state.activeIssue?.title,
            bodyExcerpt: body,
            stage: "Build",
            jobBrief: state.activeIssue?.title,
            cwd: project.cwd,
            projectBlock,
          });
          const inTok = estimateTokensFromText(preview.prompt);
          tokensIn += inTok;
          // Assume model output roughly similar order of magnitude to skill work
          tokensOutEst += Math.round(EST_TOKENS_PER_SKILL * 0.55);

          await this.runSkillStep(i, {
            trackCost: false,
            onProgress,
          });
          if (cancelRequested) {
            cancelled = true;
            const step = stepAt(i);
            results.push({
              index: i,
              command: step?.command || `step-${i}`,
              ok: false,
            });
            break;
          }
        } catch (err) {
          if (!cancelRequested) {
            dispatch({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            });
          } else {
            cancelled = true;
            break;
          }
        }

        const step = stepAt(i);
        results.push({
          index: i,
          command: step?.command || `step-${i}`,
          ok: Boolean(state.lastInject?.ok),
        });

        // Mark this skill completed → strikethrough (done: i < index)
        dispatch({ type: "build/step", index: i + 1 });
        dispatch({
          type: "run/cost",
          patch: {
            running: true,
            step: i + 1,
            total: SKILL_CHAIN.length,
            startedAt,
            elapsedMs: Date.now() - startedAt,
            tokensIn,
            tokensOutEst,
          },
        });
        if (onProgress) onProgress(getView());
      }

      const durationMs = Date.now() - startedAt;
      const tokensEst = tokensIn + tokensOutEst;
      const okCount = results.filter((r) => r.ok).length;

      if (cancelled || cancelRequested) {
        cancelRequested = false;
        // Full reset so cancel never leaves half-struck rows or stale timers
        dispatch({ type: "run/reset" });
        if (onProgress) onProgress(getView());
        return getView();
      }

      // Brief “all done” flash (full strikethrough + totals), then full reset
      dispatch({ type: "build/step", index: SKILL_CHAIN.length });
      const summary = results
        .map((r) => `${r.command}:${r.ok ? "ok" : "fail"}`)
        .join(" · ");
      dispatch({
        type: "inject/result",
        ok: okCount === results.length,
        method: "chain",
        detail: `Chain done ${okCount}/${results.length} in ${formatDuration(durationMs / 1000)} · ~${formatTokens(tokensEst)}. ${summary}`,
      });
      dispatch({
        type: "run/cost",
        patch: {
          running: false,
          step: SKILL_CHAIN.length,
          total: SKILL_CHAIN.length,
          startedAt: null,
          elapsedMs: durationMs,
          tokensIn,
          tokensOutEst,
          lastDurationMs: durationMs,
          lastTokensEst: tokensEst,
        },
      });
      if (okCount < results.length) {
        dispatch({
          type: "error",
          message: `Some skills failed inject (${okCount}/${results.length}).`,
        });
      } else {
        dispatch({ type: "error", message: null });
      }
      if (onProgress) onProgress(getView());

      // Once finished: reset strikethroughs, process, timers — ready to run again
      await new Promise((r) => setTimeout(r, 700));
      if (!cancelRequested) {
        dispatch({ type: "run/reset" });
      }
      cancelRequested = false;
      if (onProgress) onProgress(getView());

      return getView();
    },

    /**
     * Prefill ticket fields from active project using synthesized Build/Measure
     * natures (CONTEXT.md + package + tree). Overwrites when `force`.
     * @param {{ force?: boolean }} [opts]
     */
    applyProjectToFields(opts = {}) {
      const project = activeProject();
      const force = Boolean(opts.force);
      const synthesized = synthesizeTicketFromProject(project);
      const prev = state.fields || { ...EMPTY_FIELDS };
      /** @type {import('./template').TicketFields} */
      const next = { ...prev };

      for (const key of Object.keys(synthesized)) {
        const k = /** @type {keyof typeof synthesized} */ (key);
        if (force || !String(next[k] || "").trim()) {
          next[k] = synthesized[k];
        }
      }

      dispatch({ type: "fields/set", fields: next });
      dispatch({ type: "error", message: null });
      // Reset chain to grill after fill so admin can run main flow
      if (force) {
        dispatch({ type: "build/step", index: 0 });
        dispatch({ type: "stage/set", stage: "Backlog" });
      }
      return getView();
    },

    /**
     * @param {string} prompt
     * @param {{
     *   skillPath?: string|null,
     *   skillOk?: boolean,
     *   preferCwd?: string,
     *   chainPos?: string,
     *   stepIndex?: number,
     *   command?: string,
     *   label?: string,
     * }} [meta]
     */
    async _inject(prompt, meta = {}) {
      try {
        if (cancelRequested) {
          dispatch({
            type: "inject/result",
            ok: false,
            method: "cancel",
            detail: "Cancelled before inject",
          });
          return getView();
        }

        const preferCwd =
          meta.preferCwd ||
          process.env.CUM_BML_CWD ||
          process.env.GUM_BML_CWD ||
          activeProject().cwd ||
          process.cwd();

        // Persist full prompt for live terminal tail (bml-live)
        const logged = writePromptLog(prompt, {
          statePath,
          stepIndex: meta.stepIndex,
          command: meta.command,
          label: meta.label,
          chainPos: meta.chainPos,
        });
        dispatch({
          type: "prompt/set",
          prompt: {
            at: logged.at,
            stepIndex: meta.stepIndex ?? null,
            command: meta.command || null,
            label: meta.label || null,
            charCount: logged.charCount,
            preview: logged.preview,
            path: logged.path,
          },
        });

        // Admin carte blanche: always-approve tool use for BML injects
        const result = await inject(prompt, {
          preferCwd,
          yolo: true,
        });
        if (cancelRequested || /cancell?ed/i.test(String(result.detail || ""))) {
          dispatch({
            type: "inject/result",
            ok: false,
            method: "cancel",
            detail: result.detail || "Cancelled during inject",
          });
          return getView();
        }
        const skillNote = meta.skillPath
          ? ` skill=${meta.skillPath}`
          : meta.skillOk === false
            ? " skill=MISSING"
            : "";
        const projNote = ` project=${preferCwd}`;
        const chainNote = meta.chainPos ? ` ${meta.chainPos}` : "";
        dispatch({
          type: "inject/result",
          ok: result.ok,
          method: result.method,
          detail: `${result.detail || ""}${skillNote}${projNote}${chainNote} · carte-blanche`.trim(),
        });
        return getView();
      } catch (err) {
        if (cancelRequested) {
          dispatch({
            type: "inject/result",
            ok: false,
            method: "cancel",
            detail: "Cancelled during inject",
          });
          return getView();
        }
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async postMeasure(note) {
      if (!state.activeIssue) {
        return dispatch({
          type: "error",
          message: "Select or create an experiment issue first.",
        });
      }
      try {
        await github.postMeasureComment(state.activeIssue, note);
        dispatch({
          type: "measure/note",
          text: note.text,
          value: note.value,
        });
        dispatch({ type: "error", message: null });
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async recordLearn(decision, evidence) {
      if (!state.activeIssue) {
        return dispatch({
          type: "error",
          message: "Select or create an experiment issue first.",
        });
      }
      try {
        await github.recordLearnDecision(
          state.activeIssue,
          decision,
          evidence
        );
        dispatch({
          type: "learn/decision",
          decisionLabel: decision,
          evidenceWritten: Boolean(evidence && String(evidence).trim()),
        });
        dispatch({ type: "error", message: null });
        return getView();
      } catch (err) {
        return dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

module.exports = {
  createBmlCoach,
};
