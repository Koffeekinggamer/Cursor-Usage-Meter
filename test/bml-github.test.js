"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  loadGithubConfig,
  scopeHint,
  createGithubClient,
} = require("../src/lib/bml/github");

describe("loadGithubConfig", () => {
  it("uses defaults and env overrides", () => {
    const d = loadGithubConfig({ env: {} });
    assert.equal(d.owner, "Book-IQ");
    assert.equal(d.projectNumber, 1);
    assert.equal(d.repo, "Book-IQ/bookiqv1-rc");

    const o = loadGithubConfig({
      env: {
        GUM_BML_OWNER: "Acme",
        GUM_BML_PROJECT: "9",
        GUM_BML_REPO: "Acme/app",
      },
    });
    assert.equal(o.owner, "Acme");
    assert.equal(o.projectNumber, 9);
    assert.equal(o.repo, "Acme/app");
  });
});

describe("scopeHint", () => {
  it("detects missing project scopes", () => {
    assert.match(
      scopeHint("missing required scopes [read:project]"),
      /gh auth refresh/
    );
  });
});

describe("createGithubClient", () => {
  it("creates issue with experiment label via gh", async () => {
    const calls = [];
    const client = createGithubClient({
      config: {
        owner: "Book-IQ",
        projectNumber: 1,
        repo: "Book-IQ/bookiqv1-rc",
      },
      run: async (_bin, args) => {
        calls.push(args);
        if (args[0] === "issue" && args[1] === "create") {
          return {
            code: 0,
            stdout: "https://github.com/Book-IQ/bookiqv1-rc/issues/99\n",
            stderr: "",
          };
        }
        if (args[0] === "project" && args[1] === "item-add") {
          return { code: 0, stdout: "done\n", stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "unexpected " + args.join(" ") };
      },
    });

    const issue = await client.createExperiment({
      hypothesis: "Customers act on weekly insights.",
      build: "Ship insight events.",
      measure: "≥60% · kill <40% · 4 weeks",
      learn: "",
      acceptanceCriteria: "- [ ] events",
      technicalContext: "@src",
    });

    assert.equal(issue.number, 99);
    assert.match(issue.url, /issues\/99/);
    assert.ok(calls.some((a) => a.includes("experiment")));
    assert.ok(calls.some((a) => a[0] === "project"));
  });

  it("countWip counts Build/Measure items", () => {
    const client = createGithubClient({
      run: async () => ({ code: 0, stdout: "", stderr: "" }),
    });
    const n = client.countWip([
      { title: "A", status: { name: "Build" } },
      { title: "B", status: { name: "Measure" } },
      { title: "C", status: { name: "Backlog" } },
    ]);
    assert.equal(n, 2);
  });
});
