"use strict";

/**
 * Greenfield product intake — when user says "build a note app" etc.
 * Recommend stack, gather requirements, then scaffold + small-task production loop.
 */

const GREENFIELD_RE =
  /\b(let'?s\s+)?(build|create|make|start|scaffold|spin\s*up)\b[\s\S]{0,40}\b(app|application|saas|product|mvp|website|platform|tool|service|api|cli)\b|\bnew\s+(project|app|product|saas)\b|\bfrom\s+scratch\b|\bgreenfield\b|\bblank\s+repo\b/i;

const APP_TYPE_HINTS = [
  { re: /\b(note|notes|notepad|markdown\s*editor)\b/i, type: "notes", label: "Notes / markdown app" },
  { re: /\b(todo|task|kanban|checklist)\b/i, type: "todo", label: "Todo / task app" },
  { re: /\b(chat|messaging|inbox)\b/i, type: "chat", label: "Chat / messaging" },
  { re: /\b(blog|cms|content)\b/i, type: "cms", label: "Blog / CMS" },
  { re: /\b(dashboard|admin|analytics)\b/i, type: "dashboard", label: "Dashboard / admin" },
  { re: /\b(e-?commerce|shop|store)\b/i, type: "ecommerce", label: "E-commerce" },
  { re: /\b(api|backend|service)\b/i, type: "api", label: "API / service" },
  { re: /\b(cli|command[- ]line)\b/i, type: "cli", label: "CLI tool" },
  { re: /\b(mobile|ios|android|react\s*native)\b/i, type: "mobile", label: "Mobile app" },
];

/** Recommended stacks — (recommended) first. Keep concise for token budget. */
const STACK_CATALOG = {
  notes: {
    projectType: "web",
    recommended: {
      name: "Next.js + Hono + Prisma + Postgres + shadcn/ui",
      why: "Fast CRUD UI, typed API, durable storage — matches pcore web template",
      languages: ["typescript"],
      frameworks: ["nextjs", "hono", "prisma", "react-query", "shadcn"],
      databases: ["postgresql"],
      auth: "better-auth",
      deploy: "vercel + neon",
    },
    alternatives: [
      { name: "Next.js + Supabase", why: "Auth+DB+realtime in one — fastest MVP" },
      { name: "SvelteKit + SQLite", why: "Smaller surface, local-first notes" },
    ],
  },
  todo: {
    projectType: "web",
    recommended: {
      name: "Next.js + Hono + Prisma + Postgres + shadcn/ui",
      why: "Same as notes — lists/boards map cleanly to relational models",
      languages: ["typescript"],
      frameworks: ["nextjs", "hono", "prisma"],
      databases: ["postgresql"],
      auth: "better-auth",
      deploy: "vercel + neon",
    },
    alternatives: [
      { name: "Next.js + Supabase", why: "Realtime sync for shared boards" },
    ],
  },
  chat: {
    projectType: "saas",
    recommended: {
      name: "Next.js + Hono + Postgres + Redis + WebSockets",
      why: "Realtime channels need pub/sub; keep API separate from UI",
      languages: ["typescript"],
      frameworks: ["nextjs", "hono"],
      databases: ["postgresql", "redis"],
      auth: "better-auth",
      deploy: "fly.io / railway",
    },
    alternatives: [
      { name: "Next.js + Supabase Realtime", why: "Less infra to run early" },
    ],
  },
  cms: {
    projectType: "web",
    recommended: {
      name: "Next.js + Prisma + Postgres + MDX",
      why: "Content + preview routes; Prisma for structured metadata",
      languages: ["typescript"],
      frameworks: ["nextjs", "prisma"],
      databases: ["postgresql"],
      auth: "better-auth",
      deploy: "vercel",
    },
    alternatives: [{ name: "Astro + Content Collections", why: "Static-first blogs" }],
  },
  dashboard: {
    projectType: "web",
    recommended: {
      name: "Next.js + Hono + Prisma + shadcn/ui + charts",
      why: "Tables/filters/auth-heavy UIs fit App Router well",
      languages: ["typescript"],
      frameworks: ["nextjs", "hono", "prisma", "shadcn"],
      databases: ["postgresql"],
      auth: "better-auth",
      deploy: "vercel + neon",
    },
    alternatives: [{ name: "Remix + Postgres", why: "Form-heavy admin apps" }],
  },
  ecommerce: {
    projectType: "saas",
    recommended: {
      name: "Next.js + Hono + Prisma + Stripe",
      why: "Checkout + webhooks need solid API layer",
      languages: ["typescript"],
      frameworks: ["nextjs", "hono", "prisma"],
      databases: ["postgresql"],
      auth: "better-auth",
      deploy: "vercel + neon",
      payments: "stripe",
    },
    alternatives: [{ name: "Medusa + Next.js storefront", why: "Commerce domain primitives" }],
  },
  api: {
    projectType: "api",
    recommended: {
      name: "Hono + Prisma + Postgres + OpenAPI",
      why: "Thin runtime, typed routes, agent-friendly OpenAPI",
      languages: ["typescript"],
      frameworks: ["hono", "prisma"],
      databases: ["postgresql"],
      auth: "better-auth / jwt",
      deploy: "fly.io / cloudflare workers",
    },
    alternatives: [{ name: "Fastify + Prisma", why: "Node-centric teams" }],
  },
  cli: {
    projectType: "cli",
    recommended: {
      name: "Node + TypeScript + commander/citty",
      why: "Fast ship; matches orchestra Node tooling",
      languages: ["typescript"],
      frameworks: ["citty"],
      databases: [],
      auth: "none",
      deploy: "npm publish",
    },
    alternatives: [{ name: "Go cobra", why: "Single static binary" }],
  },
  mobile: {
    projectType: "mobile",
    recommended: {
      name: "Expo + React Native + tRPC/Hono API",
      why: "One TS stack; shared types with backend",
      languages: ["typescript"],
      frameworks: ["expo", "react-native", "hono"],
      databases: ["postgresql"],
      auth: "better-auth",
      deploy: "EAS + fly.io",
    },
    alternatives: [{ name: "Flutter", why: "Non-JS teams" }],
  },
  default: {
    projectType: "web",
    recommended: {
      name: "Next.js + Hono + Prisma + Postgres + shadcn/ui",
      why: "Default pcore web stack — production path documented in templates",
      languages: ["typescript"],
      frameworks: ["nextjs", "hono", "prisma", "shadcn"],
      databases: ["postgresql"],
      auth: "better-auth",
      deploy: "vercel + neon",
    },
    alternatives: [
      { name: "Next.js + Supabase", why: "Speed to MVP" },
      { name: "Hono API only", why: "Backend-first products" },
    ],
  },
};

const INTAKE_QUESTIONS = [
  { id: "product", q: "What is the product in one sentence? (who + problem + outcome)" },
  { id: "users", q: "Primary users? (solo / team / public)" },
  { id: "stack", q: "Accept recommended stack, or name alternative? (say 'recommended' to accept)" },
  { id: "auth", q: "Auth needed? (none / email-password / OAuth / both)" },
  { id: "data", q: "Must-have entities? (e.g. User, Note, Tag)" },
  { id: "mvp", q: "MVP features (3–7 bullets max)?" },
  { id: "out", q: "Explicitly out of scope for v1?" },
  { id: "deploy", q: "Target deploy? (local-only / vercel / other)" },
];

function isGreenfieldPrompt(text) {
  return GREENFIELD_RE.test(text || "");
}

function detectAppType(text) {
  for (const hint of APP_TYPE_HINTS) {
    if (hint.re.test(text)) return hint;
  }
  return { type: "default", label: "General product" };
}

function getStackRecommendation(appType) {
  return STACK_CATALOG[appType] || STACK_CATALOG.default;
}

function buildGreenfieldIntakeBriefing(goal) {
  const app = detectAppType(goal || "");
  const stack = getStackRecommendation(app.type);
  const rec = stack.recommended;

  const lines = [
    "## Greenfield product intake (required before code)",
    "",
    `Detected product shape: **${app.label}** (\`${app.type}\`)`,
    `Goal: ${goal}`,
    "",
    "### Recommended stack (default — user can override)",
    `- **${rec.name}** — ${rec.why}`,
    `- Languages: ${(rec.languages || []).join(", ") || "n/a"}`,
    `- Frameworks: ${(rec.frameworks || []).join(", ") || "n/a"}`,
    `- DB: ${(rec.databases || []).join(", ") || "n/a"}`,
    `- Auth: ${rec.auth || "n/a"} | Deploy: ${rec.deploy || "n/a"}`,
    "",
    "### Alternatives",
  ];
  for (const alt of stack.alternatives || []) {
    lines.push(`- ${alt.name} — ${alt.why}`);
  }

  lines.push(
    "",
    "### Parent agent workflow (do in order)",
    "1. **Present** the recommended stack + 1–2 alternatives to the user (mark recommended).",
    "2. **Gather** answers to intake questions below (or accept defaults if user says `recommended` / `defaults` / `just ship`).",
    "3. **Write** intake summary into `context/project-overview.md` + `project.yaml` (via init-project if empty repo).",
    "4. **Scaffold** if needed: `bash scripts/init-project.sh . --type " +
      stack.projectType +
      " --name \"<Name>\"` from pcore-orchestra (or PowerShell `init-project.ps1`).",
    "5. **Break work** into small vertical slices (MVP → polish → production).",
    "6. **Loop** core orchestra per slice: plan→implement→commit→verify→review until production checklist passes.",
    "7. **Research** stack docs only when needed (Context7/MCP or one targeted web search) — prefer six-file + templates.",
    "",
    "### Intake questions",
    ...INTAKE_QUESTIONS.map((x, i) => `${i + 1}. ${x.q}`),
    "",
    "### Small-task production loop",
    "- Slice size: one feature that ships end-to-end (UI + API + DB + test) per orchestra cycle",
    "- After each slice: phase commit gate (commit before next phase)",
    "- Production gate: auth (if required), tests, lint, deploy config, README, progress-tracker, no secrets",
    "- Continue slices until MVP Done-when + production checklist are green",
    "",
    "### First agent",
    "- Empty / new product → **enterprise** route starting at `idea` (business-analyst) OR planner with this intake if core",
    "- Do **not** launch implementer until stack + MVP features are confirmed (or defaults accepted)",
    "",
    "If user already said `recommended` / `use defaults` / `just build it`: skip questions, lock recommended stack, scaffold, start first MVP slice."
  );

  return lines.join("\n");
}

function buildGreenfieldIntakeMeta(goal) {
  const app = detectAppType(goal || "");
  const stack = getStackRecommendation(app.type);
  return {
    greenfield: true,
    appType: app.type,
    appLabel: app.label,
    projectType: stack.projectType,
    recommendedStack: stack.recommended.name,
    questions: INTAKE_QUESTIONS.map((q) => q.id),
  };
}

module.exports = {
  GREENFIELD_RE,
  APP_TYPE_HINTS,
  STACK_CATALOG,
  INTAKE_QUESTIONS,
  isGreenfieldPrompt,
  detectAppType,
  getStackRecommendation,
  buildGreenfieldIntakeBriefing,
  buildGreenfieldIntakeMeta,
};
