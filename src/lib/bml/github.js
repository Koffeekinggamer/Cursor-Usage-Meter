"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  formatTicketBody,
  experimentTitle,
  parseTicketBody,
  validateBacklogReady,
} = require("./template");

/**
 * @typedef {{
 *   owner: string,
 *   projectNumber: number,
 *   repo: string,
 * }} GithubConfig
 */

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {GithubConfig}
 */
function loadGithubConfig(opts = {}) {
  const env = opts.env ?? process.env;
  return {
    owner: env.CUM_BML_OWNER || env.GUM_BML_OWNER || "Book-IQ",
    projectNumber: Number(env.CUM_BML_PROJECT || env.GUM_BML_PROJECT || 1) || 1,
    repo: env.CUM_BML_REPO || env.GUM_BML_REPO || "Book-IQ/bookiqv1-rc",
  };
}

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {{ spawnImpl?: typeof spawn, env?: NodeJS.ProcessEnv, input?: string }} [opts]
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string }>}
 */
function runGh(bin, args, opts = {}) {
  const spawnImpl = opts.spawnImpl || spawn;
  return new Promise((resolve) => {
    const child = spawnImpl(bin, args, {
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      resolve({
        code: 1,
        stdout,
        stderr: String(err.message || err),
      });
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (opts.input != null) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

/**
 * Detect missing project scope from gh errors.
 * @param {string} stderr
 * @returns {string|null}
 */
function scopeHint(stderr) {
  const s = String(stderr || "");
  if (/read:project|required scopes|INSUFFICIENT_SCOPES|missing required scopes/i.test(s)) {
    return "GitHub token missing project scopes. Run: gh auth refresh -s project,read:project,repo";
  }
  return null;
}

/**
 * @param {{
 *   config?: GithubConfig,
 *   ghBin?: string,
 *   run?: typeof runGh,
 *   env?: NodeJS.ProcessEnv,
 * }} [opts]
 */
function createGithubClient(opts = {}) {
  const config = opts.config || loadGithubConfig({ env: opts.env });
  const ghBin = opts.ghBin || process.env.CUM_GH_BIN || process.env.GUM_GH_BIN || "gh";
  const run = opts.run || runGh;
  const env = opts.env ?? process.env;

  /**
   * @param {string[]} args
   * @param {{ input?: string }} [extra]
   */
  async function gh(args, extra = {}) {
    const r = await run(ghBin, args, { env, input: extra.input });
    if (r.code !== 0) {
      const hint = scopeHint(r.stderr) || scopeHint(r.stdout);
      const err = new Error(
        hint || r.stderr.trim() || r.stdout.trim() || `gh failed: ${args.join(" ")}`
      );
      /** @type {any} */ (err).scopeHint = hint;
      /** @type {any} */ (err).stderr = r.stderr;
      throw err;
    }
    return r.stdout;
  }

  return {
    config,

    /**
     * Create experiment issue + add to project.
     * @param {import('./template').TicketFields} fields
     * @param {{ title?: string }} [createOpts]
     */
    async createExperiment(fields, createOpts = {}) {
      const ready = validateBacklogReady(fields);
      if (!ready.ok) {
        throw new Error(ready.errors.join(" "));
      }
      const body = formatTicketBody(fields);
      const title = createOpts.title || experimentTitle(fields);
      const tmp = path.join(
        os.tmpdir(),
        `cum-bml-body-${Date.now()}-${Math.random().toString(16).slice(2)}.md`
      );
      fs.writeFileSync(tmp, body, "utf8");
      try {
        const out = await gh([
          "issue",
          "create",
          "--repo",
          config.repo,
          "--title",
          title,
          "--label",
          "experiment",
          "--body-file",
          tmp,
        ]);
        const url = out.trim().split(/\s+/).pop();
        if (!url || !/^https?:\/\//.test(url)) {
          throw new Error(`Unexpected gh issue create output: ${out}`);
        }
        const numberMatch = url.match(/\/issues\/(\d+)/);
        const number = numberMatch ? Number(numberMatch[1]) : 0;

        try {
          await gh([
            "project",
            "item-add",
            String(config.projectNumber),
            "--owner",
            config.owner,
            "--url",
            url,
          ]);
        } catch (err) {
          // Issue exists; project add may fail on scopes — surface but return issue
          return {
            number,
            url,
            title,
            repo: config.repo,
            itemId: null,
            projectError: err instanceof Error ? err.message : String(err),
            fields,
            stage: "Backlog",
          };
        }

        return {
          number,
          url,
          title,
          repo: config.repo,
          itemId: null,
          fields,
          stage: "Backlog",
        };
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          // ignore
        }
      }
    },

    /**
     * Comment weekly Measure numbers on the issue.
     * @param {{ number: number, repo?: string }} issue
     * @param {{ text: string, value?: string|null }} note
     */
    async postMeasureComment(issue, note) {
      const repo = issue.repo || config.repo;
      const body = [
        "### Measure update (Cursor Usage Meter BML coach)",
        "",
        note.value != null && note.value !== ""
          ? `**Value:** ${note.value}`
          : null,
        note.text,
        "",
        `_Posted ${new Date().toISOString()}_`,
      ]
        .filter((l) => l != null)
        .join("\n");
      await gh([
        "issue",
        "comment",
        String(issue.number),
        "--repo",
        repo,
        "--body",
        body,
      ]);
      return { ok: true };
    },

    /**
     * Apply a Learn decision label.
     * @param {{ number: number, repo?: string }} issue
     * @param {'persevere'|'pivot'|'kill-candidate'} decision
     * @param {string} [evidence]
     */
    async recordLearnDecision(issue, decision, evidence) {
      const repo = issue.repo || config.repo;
      await gh([
        "issue",
        "edit",
        String(issue.number),
        "--repo",
        repo,
        "--add-label",
        decision,
      ]);
      if (evidence && String(evidence).trim()) {
        await gh([
          "issue",
          "comment",
          String(issue.number),
          "--repo",
          repo,
          "--body",
          `### Learn decision: \`${decision}\`\n\n${evidence.trim()}`,
        ]);
      }
      return { ok: true };
    },

    /**
     * Best-effort list of project items (JSON).
     * Returns empty list on failure with error message.
     */
    async listProjectItems() {
      try {
        const out = await gh([
          "project",
          "item-list",
          String(config.projectNumber),
          "--owner",
          config.owner,
          "--format",
          "json",
          "--limit",
          "100",
        ]);
        const parsed = JSON.parse(out || "{}");
        const items = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.items)
            ? parsed.items
            : [];
        return { ok: true, items };
      } catch (err) {
        return {
          ok: false,
          items: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    /**
     * Count items that look active in Build/Measure from item-list JSON.
     * Heuristic: status/stage field contains Build or Measure.
     * @param {unknown[]} items
     * @returns {number}
     */
    countWip(items) {
      if (!Array.isArray(items)) return 0;
      let n = 0;
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const s = JSON.stringify(item);
        if (/"Build"/i.test(s) || /"Measure"/i.test(s)) {
          // Avoid counting Done/Backlog false positives when both present
          if (/"Done"/i.test(s) && !/"Build"/i.test(s) && !/"Measure"/i.test(s)) {
            continue;
          }
          if (/\bBuild\b|\bMeasure\b/i.test(s)) n += 1;
        }
      }
      return n;
    },

    /**
     * Fetch issue body and parse fields.
     * @param {{ number: number, repo?: string }} issue
     */
    async fetchIssueFields(issue) {
      const repo = issue.repo || config.repo;
      const out = await gh([
        "issue",
        "view",
        String(issue.number),
        "--repo",
        repo,
        "--json",
        "title,body,url,labels,number",
      ]);
      const data = JSON.parse(out);
      return {
        number: data.number,
        title: data.title,
        url: data.url,
        repo,
        body: data.body || "",
        fields: parseTicketBody(data.body || ""),
        labels: Array.isArray(data.labels)
          ? data.labels.map((l) => l.name || l)
          : [],
      };
    },

    scopeHint,
  };
}

module.exports = {
  loadGithubConfig,
  runGh,
  scopeHint,
  createGithubClient,
};
