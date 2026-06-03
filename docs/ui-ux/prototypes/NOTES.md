# Loupe in-page surfaces — visual direction prototype

**Throwaway.** Delete or absorb once a direction is chosen. Not production code.

## Question

> What should the Loupe in-page surfaces look like?

Driven by [`../loupe-in-page-surfaces-interaction-spec.md`](../loupe-in-page-surfaces-interaction-spec.md)
§13 (locked interactions) and §17 (generate *whole* visual directions, not single
component assembly). The interaction skeleton is locked; this prototype only explores the
**visual language**.

## What it is

One self-contained HTML design board — `loupe-surfaces.prototype.html` — rendering all
**8 surfaces** over a faint mock dev-app backdrop, across **4 switchable visual directions**:

| Key | Direction | Material language |
| --- | --- | --- |
| A | Precision Minimal | flat, opaque, hairline borders, system control (Linear/macOS) |
| B | Soft Glass | translucent frosted glass, soft shadows, restrained |
| C | Command Line Native | dark monospace, bracketed, agent/TUI surface |
| D | Radical Concept | dark neon HUD, glowing orbs/halos — idea-mining, not necessarily shippable |

Surfaces covered: 1 Host auth CTA · 2 Project chooser · 3 Picker/Selection frame ·
4 Intent input · 5 Pin (open/done/drifted/lost/stack) · 6 Pin detail · 7 View all ·
8 Page-level status/fallback.

Live bits (so style + state + motion read true): kind selector → live accent, empty-comment
→ disabled submit + inline hint, Mark done / Copy / two-step Delete in-place, Show-done toggle.

## Run

```sh
open docs/ui-ux/prototypes/loupe-surfaces.prototype.html
```

Switch directions: floating bottom bar, or **←/→**. Direction persists in `?variant=A|B|C|D`
(URL won't update on `file://` in some browsers, but switching still works).

## Honored from the spec

Display vocabulary (open/done, located/drifted/lost, synced/local only/sync failed),
status is never colour-only (glyph + text), kind theme = accent only (never status),
comment-first intent, `Mark done` label, two-step delete, no toasts, `prefers-reduced-motion`.

## Known prototype rough edges (intentionally unpolished)

- Picker frame is a static specimen (no live hover morph / breadcrumb animation).
- Pin state badges (✓/⚠/✕) show in A/B/D; in C state is carried by border style + label/tooltip
  instead of a corner badge — C's done/drift/lost treatment is itself an open refinement.
- Surfaces are laid out as a comparison board, not composited into one live picking scene.

## Verdict

- **Chosen direction:** **A — Precision Minimal** (flat, opaque, hairline borders, no blur, system control feel).
- **Extracted to:** [`loupe-A-precision-minimal.prototype.html`](./loupe-A-precision-minimal.prototype.html) — standalone single-direction board for deep iteration, with a built-in **中/EN language toggle** (top-right, defaults to 中; English is the inline source, 中文 lives in a `ZH` dictionary, technical terms kept English). This four-way board is kept as reference until A is locked, then deleted.
- **Mix notes:** none — A taken as-is; deep visual iteration on A now in progress (spec §13 open exploration items).
- **Locked tokens to lift into the extension:** _TBD once A iteration settles._
- **Then:** fold A into `packages/extension` (real TS + Shadow DOM, rewritten properly) and delete this prototype directory.
