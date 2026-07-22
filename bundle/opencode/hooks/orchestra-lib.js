"use strict";

const constants = require("./lib/constants.js");
const io = require("./lib/io.js");
const stateManager = require("./lib/state-manager.js");
const promptClassifier = require("./lib/prompt-classifier.js");
const phaseEngine = require("./lib/phase-engine.js");
const lifecycleRecorder = require("./lib/lifecycle-recorder.js");
const heartbeatMonitor = require("./lib/heartbeat-monitor.js");
const memoryManager = require("./lib/memory-manager.js");
const historyRecorder = require("./lib/history-recorder.js");
const checkpointManager = require("./lib/checkpoint-manager.js");
const contextDetector = require("./lib/context-detector.js");
const versionManager = require("./lib/version-manager.js");
const projectManager = require("./lib/project-manager.js");
const dailyPlanner = require("./lib/daily-planner.js");
const qualityGate = require("./lib/quality-gate.js");
const observability = require("./lib/observability.js");
const selfImprovement = require("./lib/self-improvement.js");
const devops = require("./lib/devops.js");
const securityScanner = require("./lib/security-scanner.js");
const evidenceRunner = require("./lib/evidence-runner.js");

module.exports = {
  ...constants,
  ...io,
  ...stateManager,
  ...promptClassifier,
  ...phaseEngine,
  ...lifecycleRecorder,
  ...heartbeatMonitor,
  ...memoryManager,
  ...historyRecorder,
  ...checkpointManager,
  ...contextDetector,
  ...versionManager,
  ...projectManager,
  ...dailyPlanner,
  ...qualityGate,
  ...observability,
  ...selfImprovement,
  ...devops,
  ...securityScanner,
  ...evidenceRunner,
};
