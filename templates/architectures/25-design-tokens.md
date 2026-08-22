# Design Token Architecture
*Primitives — Semantic Tokens — Component Tokens — Theming — Multi-Platform Build*

**Type mapping:** `type: web`, `type: mobile`, `type: saas`
**Category:** Design tokens & theming

## Project Structure

```text
design-tokens/
├── tokens/
│   ├── primitives/                 # Tier 1 — raw values, no meaning
│   │   ├── color.json             # { "blue-500": { "$value": "#3b82f6" } }
│   │   ├── space.json
│   │   ├── typography.json         # font families, sizes, weights
│   │   ├── radius.json
│   │   ├── shadow.json
│   │   ├── motion.json
│   │   ├── breakpoint.json
│   │   └── z-index.json
│   │
│   ├── semantic/                  # Tier 2 — meaning, themeable
│   │   ├── color.json             # { "color-bg-primary": { "$value": "{blue-500}" } }
│   │   ├── space.json
│   │   ├── typography.json
│   │   ├── radius.json
│   │   ├── shadow.json
│   │   └── motion.json
│   │
│   ├── themes/                    # Theme = semantic layer swap only
│   │   ├── light.json             # overrides semantic.$value / $type
│   │   ├── dark.json
│   │   └── high-contrast.json
│   │
│   ├── component/                 # Tier 3 — only when Tier 2 diverges per component
│   │   ├── button.json
│   │   ├── input.json
│   │   └── card.json
│   │
│   ├── tokens.config.js           # Style Dictionary v4 pipeline
│   └── package.json
│
├── dist/                          # Generated, one folder per platform
│   ├── css/        (tokens.css — custom properties)
│   ├── scss/       (tokens.scss — variables)
│   ├── ts/         (tokens.ts — typed constants)
│   ├── ios/        (tokens.swift)
│   └── android/    (tokens.xml)
│
└── tools/
    ├── validate-tokens.js         # DTCG schema + name lint
    └── codemod/                   # migration scripts for $deprecated tokens
```

## Three-Tier Hierarchy

```text
[ Tier 1 — Primitives ]
    Raw, meaningless values. blue-500, space-4, font-sans.
    No semantic intent. Appearance words (blue, red, bold) ARE allowed here.
        │  {ref} alias
        ▼
[ Tier 2 — Semantic ]
    Named by intent, not appearance. color-bg-primary, space-section,
    font-heading. Appearance words (blue-500) FORBIDDEN — only {ref} to primitives.
        │  {ref} alias (only on divergence)
        ▼
[ Tier 3 — Component ]
    Present ONLY when a component needs a value no semantic token covers.
    e.g. button-focus-ring-width. Empty by default — divergence is the exception.
```

### Rule: component tokens only on divergence

Tier 3 exists to capture the rare case where a component genuinely cannot reuse a
semantic token (a unique focus ring, a one-off illustration gradient). Every new
Tier 3 token must be justified in review. If a semantic token already fits, the
component references the semantic token directly. This keeps the system flat and
prevents token sprawl.

## DTCG Format (W3C Design Tokens Community Group, Format Module 2025.10)

Tokens follow the W3C DTCG structure. Each token is an object with `$value`, `$type`,
and optional `$description` / `$deprecated`.

```json
{
  "blue-500": {
    "$value": "#3b82f6",
    "$type": "color",
    "$description": "Brand primary — used by semantic color-bg-primary"
  },
  "color-bg-primary": {
    "$value": "{blue-500}",
    "$type": "color",
    "$description": "Primary surface background"
  },
  "space-section": {
    "$value": "{space-8}",
    "$type": "dimension"
  }
}
```

### Alias syntax

References use `{group.token}` (DTCG 2025.10). Aliases resolve at build time:
primitives are referenced by semantic tokens, semantic by components. A token may
only alias a token in a lower tier (semantic → primitive, component → semantic).

### Naming rules

Naming path: `category-concept-property-variant[-state]`.

| Tier | Pattern example | Notes |
|------|-----------------|-------|
| Primitive | `blue-500`, `space-4`, `font-sans` | appearance words allowed |
| Semantic | `color-bg-primary-hover`, `space-section` | appearance words FORBIDDEN |
| Component | `button-bg-primary`, `card-radius` | divergence only |

**Forbidden in token names:** the literal characters `{`, `}`, and `.` (DTCG
reserved — `{`/`}` are alias syntax, `.` is a path separator). Use `-` as the
separator. Names must be valid identifiers so they survive JSON, CSS custom
properties, Swift, and XML.

## Theming = Swap the Semantic Layer

Theming never edits primitives or components. A theme overrides the **semantic**
layer only — in `themes/dark.json` you re-point `color-bg-primary` to a different
primitive or literal. Primitives stay constant; components reference semantic
names and inherit the swap automatically. This keeps light/dark/high-contrast
additions to a single file each and guarantees no component edits leak across themes.

```json
// themes/dark.json
{
  "color-bg-primary":   { "$value": "{blue-900}" },
  "color-text-primary": { "$value": "{gray-50}" }
}
```

## Multi-Platform Build (Style Dictionary v4)

Style Dictionary v4 consumes the DTCG token tree and emits one output per platform.
A `tokens.config.js` declares the source folders and a `format`+`transform` set per
destination, so web, iOS, and Android all build from the same source of truth.

```javascript
// tokens.config.js (Style Dictionary v4)
import StyleDictionary from "style-dictionary";

StyleDictionary.registerTransformGroup({
  name: "dtcg",
  transforms: ["name/cti/kebab", "dtcg/value", "dtcg/color"],
});

export default {
  source: ["tokens/primitives/*.json", "tokens/semantic/*.json", "tokens/component/*.json"],
  platforms: {
    css:    { transformGroup: "dtcg", files: [{ destination: "dist/css/tokens.css", format: "css/variables" }] },
    scss:   { transformGroup: "dtcg", files: [{ destination: "dist/scss/tokens.scss", format: "scss/variables" }] },
    ts:     { transformGroup: "dtcg", files: [{ destination: "dist/ts/tokens.ts", format: "typescript/es6-deep" }] },
    ios:    { transformGroup: "ios", files: [{ destination: "dist/ios/tokens.swift", format: "ios-swift/class" }] },
    android:{ transformGroup: "android", files: [{ destination: "dist/android/tokens.xml", format: "android/resources" }] },
  },
};
```

Apply a theme at build time by adding `tokens/themes/dark.json` to the `source`
array for that build target.

## Governance: Semver + $deprecated + Codemods

Tokens are a public API. Breaking changes follow semantic versioning:

- **Major** — remove or rename a token, change a primitive value that alters UI
- **Minor** — add a new token, add a new theme
- **Patch** — fix a `$description`, correct a non-visible typo

Retire tokens with `$deprecated`, never by deletion:

```json
{
  "color-primary": {
    "$value": "{color-bg-primary}",
    "$type": "color",
    "$deprecated": "Use color-bg-primary (semantic naming). Removal in v2.0."
  }
}
```

`$deprecated` tokens stay in the build (aliased to the replacement) for one major
version, emitting a console/lint warning. A `tools/codemod/` script auto-rewrites
references from the deprecated name to the replacement across the codebase, run as
part of the major upgrade. This removes the human cost of token migrations and
keeps adoption frictionless.

## Integration with Project Identity

```yaml
project:
  type: web
  name: my-token-system
  display_name: "My Token System"

stack:
  languages: [typescript, css, swift, xml]
  frameworks: [style-dictionary, react-native]
  package_manager: pnpm
  runtime: node

tooling:
  token_build: style-dictionary@4
  token_spec: "W3C DTCG Format Module 2025.10"
```

## Best Practices

- **One source of truth** — primitives are the only place a raw value appears.
- **Semantic names carry meaning** — `color-danger` not `red-500` outside primitives.
- **Themes touch semantics only** — never patch primitives or components per theme.
- **Deprecate, don't delete** — `$deprecated` plus a codemod keeps migrations safe.
- **Lint names in CI** — reject `{`, `}`, `.` and appearance words in semantic tier.
- **Divergence is exceptional** — Tier 3 component tokens require review justification.
- **Validate the DTCG schema** — `tools/validate-tokens.js` runs on every PR.
