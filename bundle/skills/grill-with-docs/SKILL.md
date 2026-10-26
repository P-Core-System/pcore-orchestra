---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design that also records decisions as ADRs and a glossary while you go. User-invoked only.
disable-model-invocation: true
---

Run the grill-me interview protocol (one question at a time: goal → users → scope → data → edge cases → dependencies → security → scale → rollback → cost), and additionally capture the result as documents as the conversation proceeds.

Documenting rules:
1. When a non-trivial decision locks (a choice with rejected alternatives), immediately write an ADR to `docs/adr/NNN-<slug>.md` using: Status, Context, Decision, Options considered (and why rejected), Consequences.
2. Maintain `docs/glossary.md`: every domain term the user defines gets a one-line entry, with synonyms to avoid.
3. Before each drill-down question, re-read the newest ADR and reference it ("per ADR-004 you chose X — what about Y?").
4. Do not implement anything; the deliverable is the sharpened plan plus the ADR log and glossary.

Finish with: decisions locked (linked ADRs), open gaps, riskiest assumption and its cheapest test.
