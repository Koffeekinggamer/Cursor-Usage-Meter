"use strict";

/**
 * Main-process BML coach: state persistence + github + inject orchestration.
 */

const path = require("path");
const fs = require("fs");
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
  loadProjectAt,
  formatProjectContextForPrompt,
  synthesizeTicketFromProject,
} = require("./project-context");
const { listSelectableProjects } = require("./active-session");
const { writePromptLog } = require("./prompt-log");
const {
  waitForAgentIdle,
  wantAutoContinue,
} = require("./agent-idle");

/**
 * @param {{
 *   statePath?: string,
 *   appData?: string,
 *   github?: ReturnType<typeof createGithubClient>,
 *   inject?: typeof injectIntoCursor,
 *   waitForAgentIdle?: typeof waitForAgentIdle,
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
  const waitIdle = opts.waitForAgentIdle || waitForAgentIdle;
  /** Cooperative cancel for chain + single-skill runs (and kills active inject). */
  let cancelRequested = false;
  /** Last user-selected project cwd BML is bound to (null until picked). */
  let boundCwd = null;
  let boundAgentId = null;

  function persist() {
    try {
      saveBmlState(statePath, state);
    } catch {
      // best effort
    }
  }

  function normalizeCwd(cwd) {
    if (!cwd) return null;
    try {
      return path.resolve(String(cwd));
    } catch {
      return String(cwd);
    }
  }

  function selectedCwd() {
    return (
      normalizeCwd(process.env.CUM_BML_CWD || process.env.GUM_BML_CWD) ||
      normalizeCwd(state.selectedProjectCwd)
    );
  }

  function projectChoices() {
    try {
      const list = listSelectableProjects({ env: process.env });
      const prefer = selectedCwd();
      if (prefer && !list.some((p) => p.cwd === prefer)) {
        try {
          if (fs.existsSync(prefer)) {
            list.push({
              cwd: prefer,
              name: path.basename(prefer),
              source: "selected",
            });
            list.sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
            );
          }
        } catch {
          // ignore
        }
      }
      return list;
    } catch {
      return [];
    }
  }

  /**
   * Rebind BML to the user-selected project (dropdown), not the open chat.
   * Usage/token polling is independent — this only updates coach state.
   * @param {{ force?: boolean }} [opts]
   * @returns {{ changed: boolean, project: import('./project-context').ProjectContext|null }}
   */
  function syncActiveProject(opts = {}) {
    const force = Boolean(opts.force);
    let project = null;
    try {
      project = activeProject();
    } catch {
      project = null;
    }
    const cwd = normalizeCwd(project?.cwd);
    const changed = Boolean(cwd && cwd !== boundCwd);

    if (changed || (force && cwd && !boundCwd)) {
      if (changed && boundCwd) {
        cancelRequested = true;
        try {
          abortActiveInject();
        } catch {
          // ignore
        }
        cancelRequested = false;
        state = reduceBmlState(state, { type: "run/reset" });
        state = reduceBmlState(state, { type: "build/step", index: 0 });
        state = {
          ...state,
          activeIssue: null,
          fields: { ...EMPTY_FIELDS },
          stage: "Build",
          tinyBuild: false,
        };
        persist();
      }
      boundCwd = cwd;
      boundAgentId = null;
    }

    if (!cwd) {
      boundCwd = null;
      boundAgentId = null;
    } else {
      ensureExperimentFromChatProject();
    }

    return { changed: changed || Boolean(force && cwd), project };
  }

  function dispatch(action) {
    state = reduceBmlState(state, action);
    persist();
    return getView();
  }

  /**
   * After clipboard paste/send: wait for Agent to go idle, then strike the step.
   * @param {{
   *   stepIndex: number,
   *   command?: string|null,
   *   preferCwd?: string|null,
   *   onProgress?: ((view: object) => void)|null,
   *   keepRunning?: boolean,
   *   startedAt?: number,
   *   tokensIn?: number,
   *   tokensOutEst?: number,
   * }} args
   * @returns {Promise<{ advanced: boolean, cancelled: boolean }>}
   */
  async function autoCompleteAfterInject(args) {
    const i = args.stepIndex;
    const preferCwd = args.preferCwd || process.cwd();
    const onProgress = args.onProgress || null;

    dispatch({
      type: "inject/result",
      ok: true,
      method: state.lastInject?.method || "clipboard",
      needsConfirm: true,
      continueChain: true,
      stepIndex: i,
      command: args.command || null,
      detail: `Agent running ${args.command || `step ${i + 1}`}… will auto-continue when idle.`,
    });
    if (args.keepRunning) {
      dispatch({
        type: "run/cost",
        patch: {
          running: true,
          step: i + 1,
          total: SKILL_CHAIN.length,
          startedAt: args.startedAt || Date.now(),
          elapsedMs: args.startedAt ? Date.now() - args.startedAt : 0,
          tokensIn: args.tokensIn || 0,
          tokensOutEst: args.tokensOutEst || 0,
        },
      });
    }
    if (onProgress) onProgress(getView());

    const settled = await waitIdle({
      cwd: preferCwd,
      env: process.env,
      isCancelled: () => cancelRequested,
      onTick: (info) => {
        dispatch({
          type: "inject/result",
          ok: true,
          method: state.lastInject?.method || "clipboard",
          needsConfirm: true,
          continueChain: true,
          stepIndex: i,
          command: args.command || null,
          detail: `${info.detail} (${i + 1}/${SKILL_CHAIN.length})`,
        });
        if (onProgress) onProgress(getView());
      },
    });

    if (cancelRequested || !settled.ok) {
      return { advanced: false, cancelled: true };
    }

    dispatch({ type: "build/step", index: i + 1 });
    dispatch({
      type: "inject/result",
      ok: true,
      method: "auto-continued",
      needsConfirm: false,
      stepIndex: i,
      command: args.command || null,
      detail: `Auto-continued after ${args.command || `step ${i + 1}`} (${settled.reason}).`,
    });
    return { advanced: true, cancelled: false };
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
    const prefer = selectedCwd();
    if (!prefer) return null;
    try {
      return loadProjectAt(prefer, {
        sessionId: null,
        sessionLive: false,
        sessionSource: "user_selected",
        boundToChat: false,
      });
    } catch {
      try {
        return loadActiveProjectContext({ preferCwd: prefer });
      } catch {
        return null;
      }
    }
  }

  /**
   * The dropdown-selected project IS the experiment. Bind issue + synthesize
   * Build/Measure from that repo whenever the selection changes.
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
      awaitingConfirm: Boolean(state.lastInject?.needsConfirm),
      autoContinue: wantAutoContinue(process.env),
      injectStatus: state.lastInject?.detail || null,
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
            appProfile: project.appProfile
              ? {
                  id: project.appProfile.id,
                  label: project.appProfile.label,
                  host: project.appProfile.host,
                }
              : null,
          }
        : null,
      boundCwd,
      boundAgentId,
      selectedProjectCwd: selectedCwd(),
      projectChoices: projectChoices(),
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
    syncActiveProject,

    /**
     * Open/close BML. Opening uses the dropdown-selected project (if any).
     * @param {boolean} open
     * @param {{
     *   autoProcess?: boolean,
     *   onProgress?: (view: object) => void,
     * }} [opts]
     */
    async setPanelOpen(open, opts = {}) {
      dispatch({ type: open ? "panel/open" : "panel/close" });
      if (!open) return getView();

      const prevCwd = boundCwd;
      const { changed, project } = syncActiveProject({ force: true });
      const onProgress =
        typeof opts.onProgress === "function" ? opts.onProgress : null;
      const autoProcess = opts.autoProcess !== false;

      if (!project?.cwd) {
        return dispatch({
          type: "error",
          message: "Select a project in the BML dropdown to start.",
        });
      }

      if (!autoProcess) return getView();

      if (
        !changed &&
        state.lastInject?.needsConfirm &&
        prevCwd === boundCwd
      ) {
        return getView();
      }

      if (onProgress) onProgress(getView());
      return this.runAllSkillSteps({ onProgress });
    },

    /**
     * User picked a project from the BML dropdown.
     * @param {string|null|undefined} cwd
     */
    setSelectedProject(cwd) {
      const next = normalizeCwd(cwd);
      const prev = selectedCwd();
      dispatch({ type: "project/select", cwd: next });
      if (next && next !== prev) {
        cancelRequested = true;
        try {
          abortActiveInject();
        } catch {
          // ignore
        }
        cancelRequested = false;
        state = reduceBmlState(state, { type: "run/reset" });
        state = reduceBmlState(state, { type: "build/step", index: 0 });
        state = {
          ...state,
          activeIssue: null,
          fields: { ...EMPTY_FIELDS },
          stage: "Build",
          tinyBuild: false,
          selectedProjectCwd: next,
        };
        persist();
        boundCwd = null;
      } else if (!next) {
        boundCwd = null;
        boundAgentId = null;
      }
      syncActiveProject({ force: true });
      return getView();
    },

    async togglePanel(opts = {}) {
      if (state.panelOpen) {
        return this.setPanelOpen(false, opts);
      }
      return this.setPanelOpen(true, opts);
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
     * @param {{ trackCost?: boolean, onProgress?: (view: object) => void, continueChain?: boolean }} [opts]
     */
    async runSkillStep(index, opts = {}) {
      const i =
        Number.isInteger(index) && index >= 0
          ? index
          : state.buildStepIndex;
      const trackCost = opts.trackCost !== false;
      const continueChain = Boolean(opts.continueChain);
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
      if (!project?.cwd) {
        return dispatch({
          type: "error",
          message: "Select a project in the BML dropdown to start.",
        });
      }
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
              continueChain,
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
          appProfile: project.appProfile || null,
          extra: [
            chainPos,
            "You are one step in an admin carte-blanche BML skill run. Complete THIS skill fully before stopping.",
            "Do not skip ahead to later chain steps — the coach will invoke those next when auto-running.",
            "Act with full authority to finish the work; prefer decisive implementation over asking permission.",
            "Use Cursor Auto; choose skill depth for the detected app profile only.",
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
          continueChain,
        });
      } catch (err) {
        if (!cancelRequested) {
          dispatch({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (
        solo &&
        state.lastInject?.ok &&
        state.lastInject?.needsConfirm &&
        wantAutoContinue(process.env) &&
        !cancelRequested
      ) {
        const done = await autoCompleteAfterInject({
          stepIndex: i,
          command: step?.command,
          preferCwd,
          onProgress,
          keepRunning: true,
          startedAt,
        });
        if (done.cancelled || cancelRequested) {
          return finishSolo({ cancelled: true });
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
            if (state.lastInject?.ok && !state.lastInject?.needsConfirm) {
              // Mark this skill done only when inject actually finished work
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

      ensureExperimentFromChatProject();
      const project = activeProject();
      if (!project?.cwd) {
        return dispatch({
          type: "error",
          message: "Select a project in the BML dropdown to start.",
        });
      }
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
            appProfile: project.appProfile || null,
          });
          const inTok = estimateTokensFromText(preview.prompt);
          tokensIn += inTok;
          // Assume model output roughly similar order of magnitude to skill work
          tokensOutEst += Math.round(EST_TOKENS_PER_SKILL * 0.55);

          await this.runSkillStep(i, {
            trackCost: false,
            onProgress,
            continueChain: true,
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
          if (state.lastInject?.needsConfirm) {
            // Handled below after try/catch via needsConfirm branch
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

        // Clipboard paste/send: auto-wait for Agent idle, then next skill (default).
        // Set CUM_BML_AUTO_CONTINUE=0 to pause for manual Continue instead.
        if (state.lastInject?.needsConfirm) {
          if (wantAutoContinue(process.env)) {
            const done = await autoCompleteAfterInject({
              stepIndex: i,
              command: step?.command,
              preferCwd: project.cwd || process.cwd(),
              onProgress,
              keepRunning: true,
              startedAt,
              tokensIn,
              tokensOutEst,
            });
            if (done.cancelled || cancelRequested) {
              cancelled = true;
              break;
            }
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
            continue;
          }

          dispatch({
            type: "inject/result",
            ok: true,
            method: state.lastInject.method || "clipboard",
            needsConfirm: true,
            continueChain: true,
            stepIndex: i,
            command: step?.command,
            detail:
              (state.lastInject.detail || "Prompt copied.") +
              ` Pause: when Agent finishes, click Continue (${i + 1}/${SKILL_CHAIN.length}).`,
          });
          dispatch({
            type: "run/cost",
            patch: {
              running: false,
              step: i + 1,
              total: SKILL_CHAIN.length,
              startedAt: null,
              elapsedMs: Date.now() - startedAt,
              tokensIn,
              tokensOutEst,
            },
          });
          if (onProgress) onProgress(getView());
          return getView();
        }

        // Real inject (e.g. SDK) finished — mark completed → strikethrough
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
        // Keep paths out of the UI status; stash on the result for debugging only.
        const debugNote = `${skillNote}${projNote}${chainNote}`.trim();
        dispatch({
          type: "inject/result",
          ok: result.ok,
          method: result.method,
          needsConfirm: Boolean(result.needsConfirm),
          stepIndex: meta.stepIndex ?? null,
          command: meta.command || null,
          continueChain: Boolean(meta.continueChain),
          detail: result.ok
            ? result.detail || "Prompt copied."
            : `${result.detail || "Inject failed."}${debugNote ? ` ${debugNote}` : ""}`.trim(),
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

    /**
     * After clipboard paste: mark the waiting skill done, optionally copy the next one.
     * @param {{
     *   continueChain?: boolean,
     *   onProgress?: (view: object) => void,
     * }} [opts]
     */
    async confirmInjectedStep(opts = {}) {
      const onProgress =
        typeof opts.onProgress === "function" ? opts.onProgress : null;
      const li = state.lastInject;
      if (!li?.needsConfirm) {
        return dispatch({
          type: "error",
          message: "Nothing waiting on paste confirmation.",
        });
      }

      const i =
        Number.isInteger(li.stepIndex) && li.stepIndex >= 0
          ? li.stepIndex
          : state.buildStepIndex;
      const continueChain = opts.continueChain !== false && li.continueChain !== false;

      // User affirms Agent finished this skill — now strikethrough it
      dispatch({ type: "build/step", index: i + 1 });
      dispatch({
        type: "inject/result",
        ok: true,
        method: "confirmed",
        needsConfirm: false,
        stepIndex: i,
        command: li.command,
        detail: `Confirmed ${li.command || `step ${i + 1}`} done.`,
      });

      if (!continueChain || i + 1 >= SKILL_CHAIN.length) {
        dispatch({
          type: "run/cost",
          patch: {
            running: false,
            step: Math.min(i + 1, SKILL_CHAIN.length),
            total: SKILL_CHAIN.length,
            startedAt: null,
          },
        });
        if (onProgress) onProgress(getView());
        return getView();
      }

      // Copy the next skill and pause again for paste
      return this.runSkillStep(i + 1, {
        trackCost: true,
        onProgress,
        continueChain: true,
      });
    },
  };
}

module.exports = {
  createBmlCoach,
};
