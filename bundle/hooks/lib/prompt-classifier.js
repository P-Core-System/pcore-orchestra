"use strict";

const {
  PROMPT_MIN_LENGTH,
  GOAL_MAX_LENGTH,
  CLASSIFICATION_MULTISTEP_MIN_LENGTH,
  LOOP_MODE_CORE,
  LOOP_MODE_ENTERPRISE,
} = require("./constants.js");

const QUESTION_ONLY_RE =
  /^(what is|what are|how does|why does|explain|describe|tell me about)\b/i;

const OPT_OUT_RE =
  /\b(no orchestra|skip orchestra|disable orchestra|orchestra off|don't orchestrate|do not orchestrate|just explain|only explain|quick answer|no code|question only|brainstorm only|summarize this|tl;dr)\b/i;

const ENTERPRISE_RE =
  /(?:^|\s)\/enterprise\b|\b(enterprise sdlc|full sdlc|full lifecycle|enterprise orchestra)\b/i;

const OPT_IN_EXPLICIT_RE =
  /(?:^|\s)\/orchestra\b|\b(orchestra loop|run orchestra|agent orchestra)\b/i;

const COMPLEXITY_RE =
  /\b(architect(ure|ural)?|redesign|migrate(tion)?|multi[- ]?(service|repo|tenant)|security audit|threat model|zero[- ]?trust|platform|infrastructure|k8s|kubernetes|terraform|compliance|gdpr|hipaa|epic|roadmap|from scratch|greenfield)\b/i;

/** Formal + informal implement verbs / shorthand */
const IMPLEMENT_RE =
  /\b(add|implement|build|create|fix|refactor|update|deploy|install|setup|configure|migrate|integrate|wire|hook up|write tests|add tests|ship|continue|finish|complete|resolve|debug|patch|scaffold|generate|make it work|get it working|make \w[\w.-]* work|push to|commit|improve|pls|plz|please|can you|could you|wanna|gotta|do it|ship it|make this|help me|sort (this|it)|clean (this|it) up|next)\b/i;

const TRIVIAL_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|stop|status)\.?$/i;

/** Short / informal goals — still run core loop; planner infers from context */
const VAGUE_GOAL_RE =
  /^(fix( it)?|make it better|improve( (this|it|everything|all|next))?|next( improve| up)?|do (the )?thing|update( (stuff|all))?|clean up|refactor|build( it)?|ship( it)?|pls fix|plz fix|help|go|continue|finish|do it)\.?$/i;

const INFORMAL_HINT_RE =
  /\b(pls|plz|thx|idk|wip|asap|lgtm|nit|ty|np|gonna|wanna|gotta|kinda|sorta|tbh|imo)\b/i;

function extractPrompt(input) {
  const candidates = [
    input.prompt,
    input.user_message,
    input.message,
    input.text,
    input.content,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

function cleanGoal(text) {
  return text
    .replace(/^\/orchestra\s*/i, "")
    .replace(/^\/enterprise\s*/i, "")
    .replace(/\borchestra loop\b/gi, "")
    .replace(/\benterprise sdlc\b/gi, "")
    .trim()
    .slice(0, GOAL_MAX_LENGTH);
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isInformalOrShort(text, implement) {
  const t = text.trim();
  if (VAGUE_GOAL_RE.test(t)) return true;
  if (INFORMAL_HINT_RE.test(t)) return true;
  if (implement && wordCount(t) < 5) return true;
  if (implement && t.length < 24) return true;
  return false;
}

function selectRoute(text, { explicit, implement, multiStep }) {
  if (ENTERPRISE_RE.test(text)) {
    return {
      route: LOOP_MODE_ENTERPRISE,
      routeReason: "explicit_enterprise",
      clarifyNeeded: false,
      inferFromContext: false,
      informal: false,
    };
  }

  // Complexity / enterprise signals beat informal shortness (e.g. "migrate architecture").
  if (COMPLEXITY_RE.test(text)) {
    return {
      route: LOOP_MODE_ENTERPRISE,
      routeReason: "complexity_signals",
      clarifyNeeded: false,
      inferFromContext: false,
      informal: false,
    };
  }

  // Short/informal: still core — do NOT block. Planner expands from context.
  if (isInformalOrShort(text, implement)) {
    return {
      route: LOOP_MODE_CORE,
      routeReason: "informal_inferred",
      clarifyNeeded: false,
      inferFromContext: true,
      informal: true,
    };
  }

  return {
    route: LOOP_MODE_CORE,
    routeReason: "default_core",
    clarifyNeeded: false,
    inferFromContext: false,
    informal: false,
  };
}

function buildIntake(goal, routeInfo) {
  return {
    goal,
    route: routeInfo.route,
    routeReason: routeInfo.routeReason,
    clarifyNeeded: !!routeInfo.clarifyNeeded,
    inferFromContext: !!routeInfo.inferFromContext,
    informal: !!routeInfo.informal,
    plannerFirst: true,
    firstAgent: "orchestra-planner",
  };
}

function classifyPrompt(prompt, state) {
  const text = (prompt || "").trim();
  // Allow short implement verbs ("fix", "build it") — min length 3
  const minLen = Math.min(PROMPT_MIN_LENGTH, 3);
  if (!text || text.length < minLen) {
    return { activate: false, reason: "too_short" };
  }
  if (TRIVIAL_RE.test(text)) {
    return { activate: false, reason: "trivial" };
  }
  if (/\b\/orchestra\s+stop\b/i.test(text)) {
    return { activate: false, reason: "explicit_stop" };
  }

  const ambient = state.ambient !== false;
  const explicitCmd = /(?:^|\s)\/orchestra\b/i.test(text);
  const enterpriseCmd = /(?:^|\s)\/enterprise\b/i.test(text) || ENTERPRISE_RE.test(text);
  const explicit = OPT_IN_EXPLICIT_RE.test(text) || explicitCmd;
  const implement = IMPLEMENT_RE.test(text);
  const complexity = COMPLEXITY_RE.test(text);

  if (QUESTION_ONLY_RE.test(text) && !implement && !explicitCmd && !enterpriseCmd) {
    return { activate: false, reason: "question_only" };
  }

  if (OPT_OUT_RE.test(text) && !implement && !explicitCmd) {
    return { activate: false, reason: "opt_out" };
  }

  const multiStep =
    (text.match(/\band\b/gi) || []).length >= 2 ||
    /\b(then|after that|also|next)\b/i.test(text) ||
    text.length > CLASSIFICATION_MULTISTEP_MIN_LENGTH;

  if (!ambient && !explicit && !enterpriseCmd) {
    return { activate: false, reason: "ambient_disabled" };
  }

  if (explicit || implement || multiStep || enterpriseCmd || complexity) {
    const goal = cleanGoal(text);
    const routeInfo = selectRoute(text, {
      explicit: explicit || enterpriseCmd,
      implement,
      multiStep,
    });
    const intake = buildIntake(goal, routeInfo);
    return {
      activate: true,
      reason: explicitCmd
        ? "explicit"
        : enterpriseCmd
          ? "enterprise"
          : routeInfo.routeReason === "complexity_signals"
            ? "complexity"
            : routeInfo.informal
              ? "informal"
              : implement
                ? "implement"
                : "multistep",
      goal,
      route: routeInfo.route,
      routeReason: routeInfo.routeReason,
      clarifyNeeded: false,
      inferFromContext: routeInfo.inferFromContext,
      informal: routeInfo.informal,
      clarifyPrompt: null,
      intake,
    };
  }

  return { activate: false, reason: "no_match" };
}

module.exports = {
  extractPrompt,
  classifyPrompt,
  selectRoute,
  cleanGoal,
  buildIntake,
  isInformalOrShort,
  QUESTION_ONLY_RE,
  OPT_OUT_RE,
  OPT_IN_EXPLICIT_RE,
  ENTERPRISE_RE,
  COMPLEXITY_RE,
  IMPLEMENT_RE,
  TRIVIAL_RE,
  VAGUE_GOAL_RE,
  INFORMAL_HINT_RE,
};
