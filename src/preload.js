"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const { stepNeedle } = require("./lib/gauge");
const { faceFrame } = require("./lib/face");

contextBridge.exposeInMainWorld("tokenMeter", {
  onFaceUpdate(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("meter:face", handler);
    return () => ipcRenderer.removeListener("meter:face", handler);
  },
  getFace() {
    return ipcRenderer.invoke("meter:getFace");
  },
  refresh() {
    return ipcRenderer.invoke("usage:refresh");
  },
  dragBy(dx, dy) {
    const nx = Number(dx);
    const ny = Number(dy);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    ipcRenderer.send("window:drag", { dx: nx, dy: ny });
  },
  stepNeedle(state, targetAngle, dtSeconds) {
    return stepNeedle(state, targetAngle, dtSeconds);
  },
  faceFrame(face, angles) {
    return faceFrame(face, angles);
  },
  bml: {
    getState: () => ipcRenderer.invoke("bml:getState"),
    onState(callback) {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on("bml:state", handler);
      return () => ipcRenderer.removeListener("bml:state", handler);
    },
    setPanelOpen: (open) => ipcRenderer.invoke("bml:setPanelOpen", open),
    togglePanel: () => ipcRenderer.invoke("bml:togglePanel"),
    setFields: (fields) => ipcRenderer.invoke("bml:setFields", fields),
    applyProjectToFields: (opts) => ipcRenderer.invoke("bml:applyProjectToFields", opts || {}),
    selectExperiment: (issueRef) => ipcRenderer.invoke("bml:selectExperiment", issueRef),
    refreshBoard: () => ipcRenderer.invoke("bml:refreshBoard"),
    advanceStage: (payload) => ipcRenderer.invoke("bml:advanceStage", payload || {}),
    runSkillStep: () => ipcRenderer.invoke("bml:runSkillStep"),
    runOneSkillStep: (index) => ipcRenderer.invoke("bml:runOneSkillStep", index),
    confirmInjectedStep: (payload) =>
      ipcRenderer.invoke("bml:confirmInjectedStep", payload || {}),
    cancel: () => ipcRenderer.invoke("bml:cancel"),
    nextSkillStep: () => ipcRenderer.invoke("bml:nextSkillStep"),
    skipOptionalStep: () => ipcRenderer.invoke("bml:skipOptionalStep"),
    setTinyBuild: () => ipcRenderer.invoke("bml:setTinyBuild"),
    setBuildFlags: (flags) => ipcRenderer.invoke("bml:setBuildFlags", flags),
    setMeasureFlags: (flags) => ipcRenderer.invoke("bml:setMeasureFlags", flags),
    postMeasure: (note) => ipcRenderer.invoke("bml:postMeasure", note),
    recordLearn: (payload) => ipcRenderer.invoke("bml:recordLearn", payload),
    setStep: (index) => ipcRenderer.invoke("bml:setStep", index),
    setSelectedProject: (cwd) => ipcRenderer.invoke("bml:setSelectedProject", cwd),
    openUrl: (url) => ipcRenderer.invoke("bml:openUrl", url),
  },
});
