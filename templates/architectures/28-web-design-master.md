# Web Design Master Standard Architecture
*Visual Hierarchy — 60/30/10 Color — 8-Point Grid — Typography Scale — Responsive — Accessibility*

**Type mapping:** `type: web`, `type: mobile`, `type: saas`
**Category:** Web design standard

The AI Professional Web Design Master Prompt — a professional design standard that makes
sites look deliberately designed by a product team, not a generic AI template.

## Architectural Overview

A design system built from a small set of enforced primitives that compose into every
page. The standard is token-first: hierarchy, color, spacing, type, radius, and shadows
are defined once and reused everywhere.

```text
[ Design Standard ]
    ├── Visual Hierarchy — F / Z pattern, single primary CTA
    ├── Color 60/30/10      — neutral 60, secondary 30, accent 10
    ├── 8-Point Grid        — 8..120px spacing scale
    ├── Typography          — Perfect Fourth 1.333, Inter/Geist/Plex Sans
    ├── Component System    — one variant set (buttons/inputs/cards/...)
    ├── Tokens              — color/type/spacing/radius/shadow
    ├── Responsive          — mobile-first 12-col, 375..1440px
    └── Accessibility       — WCAG AA, keyboard, focus, semantic HTML
```

## 1. Visual Hierarchy

- **F-pattern** for content-heavy pages; **Z-pattern** for landing/marketing pages.
- **CTA hierarchy:** Primary (strong accent, action label) → Secondary (outline/ghost/neutral) → Tertiary (text link/subtle).
- Exactly one primary CTA per screen — never let multiple CTAs compete.

## 2. Color 60/30/10

- 60% dominant neutral background, 30% secondary (cards/nav/sections), 10% accent (primary CTA/links/status/badges/selected/hover/focus).
- WCAG AA contrast ≥ 4.5:1 normal text; ≥ 3:1 large text.
- Avoid excess gradients and competing accents.

## 3. 8-Point Grid

Spacing from the 8-point scale: `8, 16, 24, 32, 40, 48, 64, 80, 96, 120px`.
Card internal padding ~24px; card gap 24–32px; sections 80–120px. Avoid 13/19/27/37px.

## 4. Whitespace

Generous negative space. Sections ~80–120px desktop, reduced on mobile. Whitespace
supports hierarchy — related content groups tighter, separation is deliberate.

## 5. Typography

Modern sans-serif: Inter, Plus Jakarta Sans, Geist, IBM Plex Sans.
Perfect Fourth 1.333 scale: body 16, h3 ~21, h2 ~28, h1 ~37, hero ~49.
Body 16px, line-height 1.5–1.6, max width ~65ch. Headings line-height 1.1–1.2.

## 6. Responsive

Mobile-first. Desktop 12-col grid, max width 1200–1440px; tablet adapts; mobile 1-col,
stacked CTAs, touch targets ≥ 44×44px. **Re-layout on breakpoints — never just shrink.**

## 7. Components

Consistent buttons/inputs/cards/badges/nav/modal/dropdown/tabs/alerts/forms/tables/tooltips
with consistent spacing, type, radius, color, and states. Avoid divergent variants.

## 8. Border Radius

Small token system — no random 3+7+11+17+23px: inputs/buttons 8px, cards 16px, large
containers 20–24px.

## 9. Shadows

Subtle layered elevation — low opacity, large blur, small offset. Avoid heavy black
shadows, old 3D, neumorphism, strong outlines.

## 10. Micro-interactions

Fast, subtle, purposeful, accessible — hover/focus/card/nav transitions, loading,
skeleton, feedback, accordion. Respect `prefers-reduced-motion`.

## 11. Content Hierarchy

Each section answers a question: hero (what/who/why/next), features (problem), social
proof (trust), pricing (cost/receive), CTA (next step). No template-only filler.

## 12. Visual Direction

Clean / modern / premium / professional / calm / intentional / trustworthy. Avoid excess
gradients and colors, glassmorphism, unnecessary illustrations, random shapes, overly
rounded cards, decorative elements, generic AI look.

## 13. Accessibility

Contrast, keyboard nav, visible focus, semantic HTML, heading hierarchy, form labels,
descriptive buttons, alt text, touch targets ≥ 44px. Never color-only.

## 14. UX Quality Check

Visual (hierarchy/whitespace/color/typography/alignment), UX (new-user understanding,
obvious primary CTA, subordinate secondary, nav, mobile), A11y (contrast/keyboard/focus/
touch), Responsive (375/768/1024/1440px — no overflow/broken grid/overlap/tiny buttons/
unreadable type/image breaks).

## 15. Implementation

Reusable components, design tokens, no duplicated styles, predictable layout logic,
semantic HTML, organized responsive rules, consistent spacing, optimized images, minimal
JS, accessible. If Tailwind: design-token approach, not random utilities.

## 16. Final Standard

Ask: *"Does this look like a deliberate product design system or an AI template?"* If
generic, improve hierarchy / typography / spacing / alignment / color restraint /
component consistency / responsive / content. **Add more design system, not decoration.**

## Integration with Project Identity

Persist durable choices — color tokens, typography scale, spacing tokens, component
specs, responsive rules — into `templates/context/ui-context.md` (project source of
truth) and the project's `project.yaml` (stack + types). Agents load
`context/ui-context.md` at session start and build from the persisted tokens rather than
inventing per-page values. UI skills (`web-design-master`, `ui-ux-pro-max`,
`design-system`, `ui-styling`) are installed under `~/.agents/skills/`.

## Output

- Information architecture, page/section structure, design system
- Color tokens, typography scale, spacing tokens, component specs
- Responsive, accessibility, production-ready frontend

## Best Practices

- **One primary CTA per screen** — never let multiple CTAs compete
- **8-point spacing everywhere** — never drift to odd pixel values
- **Token over utility** — colors, radii, shadows, spacing come from tokens
- **Accessibility first** — contrast, keyboard, focus, semantic HTML from the start
- **Reusable components** — shared spacing/type/radius/color/states, few variants
- **Design restraint** — fewer colors + gradients, not more decoration
- **Mobile-first responsive** — re-layout, don't shrink
- **QA on final render** — hierarchy, contrast, alignment, all breakpoints

## Complements

- [`22-ui-ux.md`](22-ui-ux.md) — design system & component library architecture
- [`24-ui-component.md`](24-ui-component.md) — component specification
- [`25-design-tokens.md`](25-design-tokens.md) — DTCG 3-tier token model (color/type/spacing/radius/shadow primitives → semantic tokens)