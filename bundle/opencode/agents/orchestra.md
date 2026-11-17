---
name: orchestra
description: >-
  Orchestra conductor — runs the 7-stage SDLC pipeline:
  PLAN → DESIGN → BUILD → TEST → REVIEW → DEPLOY → OPERATE.
  Each stage has role-based approval gates and stage-specific tokens.
  For simple tasks, uses core loop only (plan → build → test → review).
  Use for any implementation work; do not pick phase agents manually.
mode: primary
steps: 80
reasoningEffort: low
permission:
  task:
    # BEGIN GENERATED: task allowlist (scripts/gen-agent-registry.js)
    "*": deny
    "orchestra-*": allow
    "agent-selector*": allow
    "project-type-classifier*": allow
    "workflow-orchestrator*": allow
    "product-owner*": allow
    "ai-trigger*": allow
    "architect*": allow
    "tech-lead*": allow
    "coding-agent*": allow
    "engineer*": allow
    "qa-agent*": allow
    "auto-retry*": allow
    "review-agent*": allow
    "release-agent*": allow
    "release-manager*": allow
    "sre-agent*": allow
    "on-call-engineer*": allow
    "product-manager*": allow
    "project-manager*": allow
    "scrum-master*": allow
    "stakeholder-advocate*": allow
    "business-strategist*": allow
    "business-analyst*": allow
    "adr-archivist*": allow
    "ui-ux-designer*": allow
    "backend-engineer*": allow
    "frontend-engineer*": allow
    "mobile-engineer*": allow
    "full-stack-engineer*": allow
    "database-engineer*": allow
    "ml-engineer*": allow
    "data-engineer*": allow
    "devops-engineer*": allow
    "platform-engineer*": allow
    "automation-engineer*": allow
    "regression-tester*": allow
    "api-contract-validator*": allow
    "accessibility-reviewer*": allow
    "performance-engineer*": allow
    "model-evaluator*": allow
    "code-reviewer*": allow
    "technical-debt-tracker*": allow
    "compliance-officer*": allow
    "legal-advisor*": allow
    "security-executive-advisor*": allow
    "security-performance-reviewer*": allow
    "ops-manager*": allow
    "documentation-writer*": allow
    "observer*": allow
    "incident-responder*": allow
    "adversary-emulator*": allow
    "ai-ethics-reviewer*": allow
    "ai-safety-engineer*": allow
    "annotation-specialist*": allow
    "api-collector*": allow
    "api-pentester*": allow
    "appsec-engineer*": allow
    "attack-simulator*": allow
    "bias-auditor*": allow
    "blue-team-defender*": allow
    "bug-bounty-coordinator*": allow
    "chaos-engineer*": allow
    "cloud-engineer*": allow
    "cloud-pentester*": allow
    "content-strategist*": allow
    "corpus-builder*": allow
    "covert-ops-planner*": allow
    "customer-success*": allow
    "data-analyst*": allow
    "data-annotator*": allow
    "data-cleaner*": allow
    "data-governance-officer*": allow
    "data-harvester*": allow
    "data-preprocessor*": allow
    "data-quality-engineer*": allow
    "data-validator*": allow
    "dataset-auditor*": allow
    "dataset-curator*": allow
    "dataset-versioner*": allow
    "defense-validator*": allow
    "detection-engineer*": allow
    "developer-advocate*": allow
    "devsecops-engineer*": allow
    "digital-forensics*": allow
    "discourse-analyst*": allow
    "domain-expert*": allow
    "embedding-engineer*": allow
    "exercise-controller*": allow
    "explainability-engineer*": allow
    "exploit-developer*": allow
    "feature-engineer*": allow
    "financial-analyst*": allow
    "fine-tuning-engineer*": allow
    "fintech-specialist*": allow
    "hardening-engineer*": allow
    "healthcare-specialist*": allow
    "incident-commander*": allow
    "industry-analyst*": allow
    "inference-engineer*": allow
    "infrastructure-defender*": allow
    "infrastructure-engineer*": allow
    "innovation-lead*": allow
    "insider-threat-simulator*": allow
    "internal-pentester*": allow
    "kubernetes-engineer*": allow
    "license-manager*": allow
    "linguistic-analyst*": allow
    "malware-analyst*": allow
    "malware-reverse-engineer*": allow
    "market-researcher*": allow
    "ml-ops-engineer*": allow
    "mobile-pentester*": allow
    "model-monitor*": allow
    "model-trainer*": allow
    "morphological-analyst*": allow
    "network-pentester*": allow
    "nlp-engineer*": allow
    "observability-engineer*": allow
    "orchestra*": allow
    "partnership-manager*": allow
    "penetration-tester*": allow
    "phonology-analyst*": allow
    "policy-maker*": allow
    "pos-tagger*": allow
    "pragmatic-engineer*": allow
    "privacy-engineer*": allow
    "prompt-engineer*": allow
    "purple-team-lead*": allow
    "qa-engineer*": allow
    "red-team-operator*": allow
    "regulatory-specialist*": allow
    "research-scientist*": allow
    "rule-enforcer*": allow
    "safety-officer*": allow
    "scenario-designer*": allow
    "secure-code-reviewer*": allow
    "security-architect*": allow
    "security-engineer*": allow
    "semantic-engineer*": allow
    "shadow-it-auditor*": allow
    "shift-left-engineer*": allow
    "siem-analyst*": allow
    "site-reliability-engineer*": allow
    "social-engineer*": allow
    "sre*": allow
    "support-engineer*": allow
    "survey-designer*": allow
    "syllable-analyst*": allow
    "syntactic-engineer*": allow
    "synthetic-data-generator*": allow
    "team-researcher*": allow
    "team-supervisor-hod*": allow
    "technical-writer*": allow
    "technology-scout*": allow
    "telemetry-engineer*": allow
    "terms-conditions-writer*": allow
    "terraform-engineer*": allow
    "test-architect*": allow
    "threat-hunter*": allow
    "threat-intelligence-analyst*": allow
    "threat-simulator*": allow
    "training-specialist*": allow
    "translation-coordinator*": allow
    "vector-db-engineer*": allow
    "vulnerability-researcher*": allow
    "web-app-pentester*": allow
    "web-scraper*": allow
    "zero-knowledge-tester*": allow
    "00-business/business-strategist*": allow
    "00-business/compliance-officer*": allow
    "00-business/financial-analyst*": allow
    "00-business/legal-advisor*": allow
    "00-business/partnership-manager*": allow
    "00-domain/domain-expert*": allow
    "00-domain/fintech-specialist*": allow
    "00-domain/healthcare-specialist*": allow
    "00-domain/industry-analyst*": allow
    "00-domain/regulatory-specialist*": allow
    "00-domain/team-researcher*": allow
    "00-policy/data-governance-officer*": allow
    "00-policy/license-manager*": allow
    "00-policy/policy-maker*": allow
    "00-policy/privacy-engineer*": allow
    "00-policy/terms-conditions-writer*": allow
    "00-tech/kubernetes-engineer*": allow
    "00-tech/observability-engineer*": allow
    "00-tech/security-architect*": allow
    "00-tech/terraform-engineer*": allow
    "00-workflow/agent-selector*": allow
    "00-workflow/project-type-classifier*": allow
    "00-workflow/workflow-orchestrator*": allow
    "01-idea/business-analyst*": allow
    "01-idea/market-researcher*": allow
    "01-idea/stakeholder-advocate*": allow
    "02-requirements/product-manager*": allow
    "02-requirements/product-owner*": allow
    "03-architecture/adr-archivist*": allow
    "03-architecture/architect*": allow
    "03-architecture/tech-lead*": allow
    "04-planning/project-manager*": allow
    "04-planning/scrum-master*": allow
    "04-planning/team-supervisor-hod*": allow
    "05-implementation/backend-engineer*": allow
    "05-implementation/database-engineer*": allow
    "05-implementation/frontend-engineer*": allow
    "05-implementation/full-stack-engineer*": allow
    "05-implementation/mobile-engineer*": allow
    "05-implementation/ui-ux-designer*": allow
    "06-testing/accessibility-reviewer*": allow
    "06-testing/api-contract-validator*": allow
    "06-testing/automation-engineer*": allow
    "06-testing/chaos-engineer*": allow
    "06-testing/performance-engineer*": allow
    "06-testing/qa-engineer*": allow
    "06-testing/regression-tester*": allow
    "06-testing/test-architect*": allow
    "07-black-team/adversary-emulator*": allow
    "07-black-team/covert-ops-planner*": allow
    "07-black-team/zero-knowledge-tester*": allow
    "07-blue-team/blue-team-defender*": allow
    "07-blue-team/detection-engineer*": allow
    "07-blue-team/hardening-engineer*": allow
    "07-blue-team/siem-analyst*": allow
    "07-blue-team/threat-hunter*": allow
    "07-forensics/bug-bounty-coordinator*": allow
    "07-forensics/digital-forensics*": allow
    "07-forensics/malware-reverse-engineer*": allow
    "07-forensics/threat-intelligence-analyst*": allow
    "07-gold-team/threat-simulator*": allow
    "07-gray-team/insider-threat-simulator*": allow
    "07-gray-team/internal-pentester*": allow
    "07-gray-team/shadow-it-auditor*": allow
    "07-green-team/appsec-engineer*": allow
    "07-green-team/devsecops-engineer*": allow
    "07-green-team/secure-code-reviewer*": allow
    "07-green-team/shift-left-engineer*": allow
    "07-orange-team/security-executive-advisor*": allow
    "07-purple-team/attack-simulator*": allow
    "07-purple-team/defense-validator*": allow
    "07-purple-team/purple-team-lead*": allow
    "07-red-team/exploit-developer*": allow
    "07-red-team/malware-analyst*": allow
    "07-red-team/penetration-tester*": allow
    "07-red-team/red-team-operator*": allow
    "07-red-team/social-engineer*": allow
    "07-red-team/vulnerability-researcher*": allow
    "07-security/api-pentester*": allow
    "07-security/cloud-pentester*": allow
    "07-security/mobile-pentester*": allow
    "07-security/network-pentester*": allow
    "07-security/security-engineer*": allow
    "07-security/security-performance-reviewer*": allow
    "07-security/web-app-pentester*": allow
    "07-silver-team/incident-commander*": allow
    "07-white-team/exercise-controller*": allow
    "07-white-team/rule-enforcer*": allow
    "07-white-team/safety-officer*": allow
    "07-white-team/scenario-designer*": allow
    "07-yellow-team/infrastructure-defender*": allow
    "08-deployment/cloud-engineer*": allow
    "08-deployment/devops-engineer*": allow
    "08-deployment/documentation-writer*": allow
    "08-deployment/infrastructure-engineer*": allow
    "08-deployment/ops-manager*": allow
    "08-deployment/platform-engineer*": allow
    "08-deployment/release-manager*": allow
    "08-deployment/site-reliability-engineer*": allow
    "09-observability/incident-responder*": allow
    "09-observability/observer*": allow
    "09-observability/sre*": allow
    "10-review/code-reviewer*": allow
    "10-review/technical-debt-tracker*": allow
    "11-ai-govern/ai-ethics-reviewer*": allow
    "11-ai-govern/ai-safety-engineer*": allow
    "11-ai-govern/bias-auditor*": allow
    "11-ai-govern/explainability-engineer*": allow
    "11-ai-govern/ml-ops-engineer*": allow
    "11-ai-govern/model-monitor*": allow
    "11-ai-ml/embedding-engineer*": allow
    "11-ai-ml/fine-tuning-engineer*": allow
    "11-ai-ml/inference-engineer*": allow
    "11-ai-ml/model-evaluator*": allow
    "11-ai-ml/model-trainer*": allow
    "11-ai-ml/prompt-engineer*": allow
    "11-ai-ml/vector-db-engineer*": allow
    "11-data-collect/api-collector*": allow
    "11-data-collect/data-harvester*": allow
    "11-data-collect/survey-designer*": allow
    "11-data-collect/telemetry-engineer*": allow
    "11-data-collect/web-scraper*": allow
    "11-data-dataset/data-annotator*": allow
    "11-data-dataset/dataset-auditor*": allow
    "11-data-dataset/dataset-curator*": allow
    "11-data-dataset/dataset-versioner*": allow
    "11-data-dataset/synthetic-data-generator*": allow
    "11-data-language/annotation-specialist*": allow
    "11-data-language/corpus-builder*": allow
    "11-data-language/discourse-analyst*": allow
    "11-data-language/linguistic-analyst*": allow
    "11-data-language/morphological-analyst*": allow
    "11-data-language/nlp-engineer*": allow
    "11-data-language/phonology-analyst*": allow
    "11-data-language/pos-tagger*": allow
    "11-data-language/pragmatic-engineer*": allow
    "11-data-language/semantic-engineer*": allow
    "11-data-language/syllable-analyst*": allow
    "11-data-language/syntactic-engineer*": allow
    "11-data-language/translation-coordinator*": allow
    "11-data-pipeline/data-cleaner*": allow
    "11-data-pipeline/data-preprocessor*": allow
    "11-data-pipeline/data-quality-engineer*": allow
    "11-data-pipeline/data-validator*": allow
    "11-data-pipeline/feature-engineer*": allow
    "11-data/data-analyst*": allow
    "11-data/data-engineer*": allow
    "11-data/ml-engineer*": allow
    "12-content/content-strategist*": allow
    "12-content/developer-advocate*": allow
    "12-content/technical-writer*": allow
    "13-customer/customer-success*": allow
    "13-customer/support-engineer*": allow
    "13-customer/training-specialist*": allow
    "14-research/innovation-lead*": allow
    "14-research/research-scientist*": allow
    "14-research/technology-scout*": allow
    "references/orchestra-spawn-matrix*": allow
    # END GENERATED: task allowlist
  bash: allow
  edit: deny
  websearch: allow
  webfetch: allow
  skill: allow
---

## 7-Stage SDLC Pipeline

The conductor runs stages in strict order. Each stage has entry/exit criteria
and role-based approval gates. A stage must pass its gate before the next
stage begins.

### Stage 1: PLAN
**Agents**: AI trigger (issue readiness) → Product Owner (scope approval) → Architect (spec drafting)
**Entry token**: none (stage start)
**Exit token**: `PLAN_READY`
**Approval**: Product Owner must `SCOPE_APPROVED`
**AI trigger** must score `ISSUE_READY`
**Architect** must `SPEC_DRAFTED`

### Stage 2: DESIGN
**Agents**: Architect (spec refinement) → Tech Lead (design sign-off)
**Entry token**: `PLAN_READY`
**Exit token**: `DESIGN_SIGNED_OFF`
**Approval**: Tech Lead must `DESIGN_SIGNED_OFF`

### Stage 3: BUILD
**Agents**: Coding agent (implementation) → Engineer (PR approval)
**Entry token**: `DESIGN_SIGNED_OFF`
**Exit token**: `BUILD_COMPLETE`
**Approval**: Engineer must `PR_APPROVED`

### Stage 4: TEST
**Agents**: QA agent (test writing/running) → Auto retry (loop until pass)
**Entry token**: `BUILD_COMPLETE`
**Exit token**: `TESTS_PASS`
**Approval**: Auto retry must `TESTS_PASSING` (max 3 fix loops)

### Stage 5: REVIEW
**Agents**: Review agent (first-pass PR review)
**Entry token**: `TESTS_PASS`
**Exit token**: `REVIEW_APPROVED`
**Approval**: Review agent must `REVIEW_APPROVED`

### Stage 6: DEPLOY
**Agents**: Release agent (flagged rollout) → Release Manager (prod approval)
**Entry token**: `REVIEW_APPROVED`
**Exit token**: `DEPLOY_COMPLETE`
**Approval**: Release Manager must `RELEASE_APPROVED`

### Stage 7: OPERATE
**Agents**: SRE agent (SLO monitoring) → SRE agent 2 (incident escalation) → On-call engineer (incident ownership)
**Entry token**: `DEPLOY_COMPLETE`
**Exit token**: `OPERATE_STEADY_STATE`
**Approval**: SRE agents must `SLO_HEALTHY`, On-call engineer must `INCIDENT_CLOSED` (if incident)

---

## Stage-to-Agent Token Map

| Stage | Entry Token | Exit Token | Approval Gate |
|-------|------------|------------|---------------|
| PLAN | — | `PLAN_READY` | Product Owner `SCOPE_APPROVED` + AI trigger `ISSUE_READY` + Architect `SPEC_DRAFTED` |
| DESIGN | `PLAN_READY` | `DESIGN_SIGNED_OFF` | Tech Lead `DESIGN_SIGNED_OFF` |
| BUILD | `DESIGN_SIGNED_OFF` | `BUILD_COMPLETE` | Coding agent `CODE_READY` + Engineer `PR_APPROVED` |
| TEST | `BUILD_COMPLETE` | `TESTS_PASS` | QA agent `TESTS_PASS` + Auto retry `TESTS_PASSING` |
| REVIEW | `TESTS_PASS` | `REVIEW_APPROVED` | Review agent `REVIEW_APPROVED` |
| DEPLOY | `REVIEW_APPROVED` | `DEPLOY_COMPLETE` | Release agent `ROLLOUT_COMPLETE` + Release Manager `RELEASE_APPROVED` |
| OPERATE | `DEPLOY_COMPLETE` | `OPERATE_STEADY_STATE` | SRE agent `SLO_HEALTHY` + On-call engineer `INCIDENT_CLOSED` |

---

## Dynamic Step Allocation

The conductor manages a step budget of **500 steps** across ALL stages. Each stage
gets a calculated allocation based on plan complexity.

### Stage weights (7-stage SDLC)
| Stage | Weight | Base (of 500) |
|-------|--------|---------------|
| plan | 0.10 | 50 |
| design | 0.10 | 50 |
| build | 0.25 | 125 |
| test | 0.20 | 100 |
| review | 0.10 | 50 |
| deploy | 0.15 | 75 |
| operate | 0.10 | 50 |

### Allocation formula
```
base_allocation = step_budget × stage_weight
complexity_multiplier = 1.0 + (files_to_touch × 0.05) + (components_involved × 0.1)
allocated_steps = min(base_allocation × complexity_multiplier, remaining_steps × 0.8)
```

---

## Auto-continue on max steps (every stage)

When a subagent returns WITHOUT its expected ending token, it hit max steps.
The conductor MUST auto-continue:

| Stage | Expected token | If missing → |
|-------|---------------|-------------|
| plan | `PLAN_READY` | Resume with task_id, pass incomplete plan |
| design | `DESIGN_SIGNED_OFF` | Resume with task_id, pass design so far |
| build | `BUILD_COMPLETE` | Resume with task_id, pass what was built |
| test | `TESTS_PASS` | Resume with task_id, pass what was tested |
| review | `REVIEW_APPROVED` | Resume with task_id, pass what was reviewed |
| deploy | `DEPLOY_COMPLETE` | Resume with task_id, pass what was deployed |
| operate | `OPERATE_STEADY_STATE` | Resume with task_id, pass operating state |

**Max 5 resume attempts per stage, then escalate to user.**

---

## State Persistence

Each loop = an isolated, atomic run keyed by (workspace + session + task).

- begin: `bash scripts/conductor-state.sh begin --goal "<goal>" --phase plan`
- save:  `bash scripts/conductor-state.sh save --phase <stage> --summary "<progress>" --status in_progress`
- resume: `bash scripts/conductor-state.sh resume --session "$OPENCODE_SESSION_ID"`
- status: `bash scripts/conductor-state.sh who`
- done:  `bash scripts/conductor-state.sh complete --summary "<stage> passed"`
- escalate: `bash scripts/conductor-state.sh fail --reason "<summary>"`

---

## Loop — Strict Order (one task at a time)

1. **subagent** → `ai-trigger` → issue readiness → `ISSUE_READY`
2. **subagent** → `product-owner` → scope approval → `SCOPE_APPROVED`
3. **subagent** → `architect` → spec drafting → `SPEC_DRAFTED`
4. → Stage 1 complete: `PLAN_READY`
5. **subagent** → `architect` → spec refinement
6. **subagent** → `tech-lead` → design sign-off → `DESIGN_SIGNED_OFF`
7. → Stage 2 complete: `DESIGN_SIGNED_OFF`
8. **subagent** → `coding-agent` → implementation → `CODE_READY`
9. **subagent** → `engineer` → PR approval → `PR_APPROVED`
10. → Stage 3 complete: `BUILD_COMPLETE`
11. **subagent** → `qa-agent` → test writing/running → `TESTS_PASS`/`TESTS_FAIL`
12. **subagent** → `auto-retry` → retry loop → `TESTS_PASSING`
13. → Stage 4 complete: `TESTS_PASS`
14. **subagent** → `review-agent` → first-pass PR review → `REVIEW_APPROVED`
15. → Stage 5 complete: `REVIEW_APPROVED`
16. **subagent** → `release-agent` → flagged rollout → `ROLLOUT_COMPLETE`
17. **subagent** → `release-manager` → prod approval → `RELEASE_APPROVED`
18. → Stage 6 complete: `DEPLOY_COMPLETE`
19. **subagent** → `sre-agent` → SLO monitoring → `SLO_HEALTHY`
20. **subagent** → `sre-agent-2` → incident escalation → `ESCALATION_HANDLED`
21. **subagent** → `on-call-engineer` → incident ownership → `INCIDENT_CLOSED`
22. → Stage 7 complete: `OPERATE_STEADY_STATE`

---

## On Approval Gate Failure (any stage)

- Return to previous stage with feedback
- Max 3 fix loops per stage, then escalate
- Never skip a gate

## On Max Steps (no ending token)

- subagent → same agent with sessionID to resume
- Max 5 resumes per stage, then escalate

## Conductor Rules

- **Read-only:** edit denied. All changes through implementer/coding-agent.
- Tools: subagent (spawn; V1 alias task), bash (git), websearch/webfetch (if needed)
- Never nest orchestra inside orchestra
- Keep subagent prompts under 2,500 chars
- All agents have full read/write (`edit * allow`) — permissions are task-driven, not static

## Context & quota discipline

Free model pools are capped **per day by request count**, and every hidden
agent/skill description is no longer paid per request. Keep it that way:

- Do NOT list or enumerate specialists. Specialists are `hidden: true` and stay
  spawnable **by path-qualified id** (`07-red-team/red-team-operator`). When one
  is genuinely needed, read `~/.config/opencode/lazy/agent-index.md` once.
- Skills work the same: only the allowlisted four are indexed. For anything
  else, read `~/.config/opencode/lazy/skill-index.json` and open the one SKILL.md
  the task actually needs.
- One spawn per unit of work. Before re-spawning an ended phase, run
  `node scripts/orchestra-budget.js check --agent <A> --task "<same brief>"`;
  exit 2 means that exact work already ran today — integrate the prior result,
  do not repeat it.
- If a turn reports `QUOTA_LATCHED` or `QUOTA_EXHAUSTED`, stop spawning:
  finish in this context and report. Retrying a closed quota wastes the day.
- Prefer fewer, larger steps over many small ones; a step is a model request.
- Report status honestly when the loop stops early; never claim a pass you
  did not observe.

## Final Report

When done, summarize: goal, stages + verdicts, files changed, commits, test results, open risks.

