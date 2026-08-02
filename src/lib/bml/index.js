"use strict";

const template = require("./template");
const skillChain = require("./skill-chain");
const skillsResolve = require("./skills-resolve");
const gates = require("./gates");
const state = require("./state");
const activeSession = require("./active-session");
const inject = require("./inject");
const github = require("./github");
const projectContext = require("./project-context");
const liveView = require("./live-view");
const promptLog = require("./prompt-log");

module.exports = {
  ...template,
  ...skillChain,
  ...skillsResolve,
  ...gates,
  ...state,
  ...activeSession,
  ...inject,
  ...github,
  ...projectContext,
  ...liveView,
  ...promptLog,
};
