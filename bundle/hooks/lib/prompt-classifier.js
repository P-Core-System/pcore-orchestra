"use strict";

const {
  PROMPT_MIN_LENGTH,
  GOAL_MAX_LENGTH,
  CLASSIFICATION_MULTISTEP_MIN_LENGTH,
} = require("./constants.js");

const QUESTION_ONLY_RE =
  /^(what is|what are|how does|why does|explain|describe|tell me about)\b/i;

const OPT_OUT_RE =
  /\b(no orchestra|skip orchestra|disable orchestra|orchestra off|don't orchestrate|do not orchestrate|just explain|only explain|quick answer|no code|question only|brainstorm only|summarize this|tl;dr)\b/i;

const OPT_IN_EXPLICIT_RE =
  /\b(\/orchestra|orchestra loop|run orchestra|agent orchestra)\b/i;

const IMPLEMENT_RE =
  /\b(add|implement|build|create|fix|refactor|update|deploy|install|setup|configure|migrate|integrate|wire|hook up|write tests|add tests|ship|continue|finish|complete|resolve|debug|patch|scaffold|generate|make it work|get it working|push to|commit)\b/i;

const TRIVIAL_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|stop|status)\.?$/i;

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

function classifyPrompt(prompt, state) {
  const text = (prompt || "").trim();
  if (!text || text.length < PROMPT_MIN_LENGTH) {
    return { activate: false, reason: "too_short" };
  }
  if (TRIVIAL_RE.test(text)) {
    return { activate: false, reason: "trivial" };
  }
  if (/\b\/orchestra\s+stop\b/i.test(text)) {
    return { activate: false, reason: "explicit_stop" };
  }

  const ambient = state.ambient !== false;
  const explicit = OPT_IN_EXPLICIT_RE.test(text);
  const implement = IMPLEMENT_RE.test(text);

  if (QUESTION_ONLY_RE.test(text) && !implement && !explicit) {
    return { activate: false, reason: "question_only" };
  }

  if (OPT_OUT_RE.test(text) && !implement && !explicit) {
    return { activate: false, reason: "opt_out" };
  }

  const multiStep =
    (text.match(/\band\b/gi) || []).length >= 2 ||
    /\b(then|after that|also|next)\b/i.test(text) ||
    text.length > CLASSIFICATION_MULTISTEP_MIN_LENGTH;

  if (!ambient && !explicit) {
    return { activate: false, reason: "ambient_disabled" };
  }

  if (explicit || implement || multiStep) {
    const goal = text
      .replace(/^\/orchestra\s*/i, "")
      .replace(/\borchestra loop\b/gi, "")
      .trim();
    return {
      activate: true,
      reason: explicit ? "explicit" : implement ? "implement" : "multistep",
      goal: goal.slice(0, GOAL_MAX_LENGTH),
    };
  }

  return { activate: false, reason: "no_match" };
}

module.exports = {
  extractPrompt,
  classifyPrompt,
  QUESTION_ONLY_RE,
  OPT_OUT_RE,
  OPT_IN_EXPLICIT_RE,
  IMPLEMENT_RE,
  TRIVIAL_RE,
};
