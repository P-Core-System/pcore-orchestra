---
name: web-design-master
description: Professional web design standard ("AI Professional Web Design Master Prompt") covering page/section/layout design, visual hierarchy, color systems, typography scales, 8-point grid spacing, responsive breakpoints, accessibility, and design QA review. Use when designing or building any page, section, or layout so it looks deliberately designed by a professional product team rather than a generic AI template.
argument-hint: "[page, section, or component]"
license: MIT
metadata:
  author: claudekit
  version: "1.0.0"
---

# Web Design Master Skill

Professional web design standard that produces sites looking deliberately designed by a
professional team — not a generic AI template. Encodes the full "AI Professional Web
Design Master Prompt" as actionable guidance for design and build work.

## Role

Principal Product Designer, Senior UX/UI Designer, Design Systems Engineer, Senior
Frontend Engineer.

**Goal:** a site that looks deliberately designed by a professional team, not a generic
AI template. Prioritize: visual hierarchy, usability, accessibility, consistency,
responsive, performance, clean modern aesthetics, strong information architecture,
production-ready.

## When to Use This Skill

Use when:
- Designing or building a page, section, or layout (hero, features, pricing, CTA, etc.)
- Establishing a color system, typography scale, spacing tokens, or component specs
- Making the UI responsive across breakpoints (375 / 768 / 1024 / 1440px)
- Reviewing an existing design for visual hierarchy, contrast, alignment, or consistency
- Doing a design QA pass before calling a UI "done"

## 1. Visual Hierarchy

- **F-pattern** for content-heavy pages (text/reading); **Z-pattern** for landing/marketing pages.
- **CTA hierarchy:** Primary (strong accent, action label) → Secondary (outline/ghost/neutral) → Tertiary (text link/subtle).
- **Never make multiple CTAs compete** — exactly one primary per screen/section.

Example:
```
[Primary   ]> Save changes
[Secondary ]> Cancel
[Tertiary  ]> Learn more
```

## 2. Color 60/30/10

- **60% dominant neutral background**, **30% secondary** (cards/nav/sections), **10% accent** (primary CTA/links/status/badges/selected/hover/focus).
- **WCAG AA ≥ 4.5:1** for normal text; ≥ 3:1 for large text.
- Avoid excess gradients and competing accents.

## 3. 8-Point Grid

Use spacing from the 8-point scale: `8, 16, 24, 32, 40, 48, 64, 80, 96, 120px`.
- Card internal padding ~24px; card gap 24–32px; sections 80–120px.
- Avoid off-scale values like 13, 19, 27, 37px.

## 4. Whitespace

- Generous negative space. Sections ~80–120px on desktop; reduce on mobile.
- Whitespace supports hierarchy — tighter grouping for related content, more for separation.

## 5. Typography

Modern sans-serif fonts: Inter, Plus Jakarta Sans, Geist, IBM Plex Sans.
**Perfect Fourth 1.333 scale:**
- body 16, h3 ~21, h2 ~28, h1 ~37, hero ~49.
- Body 16px, line-height 1.5–1.6, max width ~65ch.
- Headings line-height 1.1–1.2.

## 6. Responsive

Mobile-first. Desktop 12-col grid, max width 1200–1440px. Tablet adapts. Mobile 1-col,
stacked CTAs, touch targets ≥ 44×44px. **Never just shrink desktop** — re-layout.

## 7. Components

Consistent buttons/inputs/cards/badges/nav/modal/dropdown/tabs/alerts/forms/tables/tooltips
with consistent spacing, type, radius, color, and states. Avoid divergent variants — one
source of truth, not five nearly-identical buttons.

## 8. Border Radius

Small token system — no random 3+7+11+17+23px:
- inputs/buttons **8px**
- cards **16px**
- large containers **20–24px**

## 9. Shadows

Subtle layered elevation — low opacity, large blur, small offset. Avoid heavy black
shadows, old 3D, neumorphism, strong outlines.

## 10. Micro-interactions

Fast, subtle, purposeful, accessible. Hover/focus/card/nav transitions, loading,
skeleton, feedback, accordion. **Respect `prefers-reduced-motion`.**

## 11. Content Hierarchy

Each section answers a question:
- hero: what / who / why / next
- features: problem
- social proof: trust
- pricing: cost / what you receive
- CTA: next step

Never emit template-only filler sections.

## 12. Visual Direction

Clean / modern / premium / professional / calm / intentional / trustworthy. Avoid excess
gradients and colors, glassmorphism, unnecessary illustrations, random shapes, overly
rounded cards, decorative elements, and the generic AI look.

## 13. Accessibility

- Color contrast, keyboard navigation, visible focus
- Semantic HTML, heading hierarchy, form labels
- Descriptive buttons, alt text, touch targets ≥ 44px
- **Never use color alone** to convey meaning

## 14. UX Quality Check

- **Visual** — hierarchy, whitespace, color, typography, alignment
- **UX** — new-user understanding, primary CTA obvious, secondary subordinate, nav, mobile
- **A11y** — contrast, keyboard, focus, touch
- **Responsive** — 375/768/1024/1440px; no overflow, broken grid, overlap, tiny buttons, unreadable type, or broken images

## 15. Implementation

- Reusable components, design tokens, no duplicated styles, predictable layout logic
- Semantic HTML, organized responsive rules, consistent spacing, optimized images
- Minimal JS, accessible
- **If Tailwind:** design-token approach — not random utilities

## 16. Final Standard

Ask: *"Does this look like a deliberate product design system or an AI template?"*
If generic, improve hierarchy / typography / spacing / alignment / color restraint /
component consistency / responsive / content. **Add more design system, not decoration.**

## Output

- Information architecture, page/section structure, design system
- Color tokens, typography scale, spacing tokens, component specs
- Responsive, accessibility, production-ready frontend

## Best Practices

1. **One primary CTA per screen** — never let multiple CTAs compete
2. **8-point spacing everywhere** — never drift to odd pixel values
3. **Token over utility** — colors, radii, shadows, spacing come from tokens
4. **Accessibility first** — contrast, keyboard, focus, semantic HTML from the start
5. **Reusable components** — shared spacing/type/radius/color/states, few variants
6. **Design restraint** — fewer colors + gradients, not more decoration
7. **Mobile-first responsive** — re-layout, don't shrink
8. **QA on final render** — check hierarchy, contrast, alignment, all breakpoints

## Complements

Pair with `ui-ux-pro-max` (product/page reasoning), `design-system` (tokens/components),
and `ui-styling` (Tailwind/shadcn theming). Reference template:
`templates/architectures/28-web-design-master.md`.