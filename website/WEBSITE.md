# WEBSITE.md — NeuroLoop Public Project Website

This is the full spec for the public-facing NeuroLoop website: a scroll-
driven 3D experience where a brain model explodes into its layers as the
visitor scrolls, then transitions into a narrative section explaining what
Parkinson's actually does to a person and which brain structures are
involved.

This document is written to be followed literally, not used as loose
inspiration. It exists specifically to prevent the page from turning into
a templated AI-generated look — every section below either makes a
concrete decision for this brief or gives a rule for making one. Where
this file says "don't," that is a hard constraint, not a preference.

---

## 1. The brief, stated plainly

**Subject:** Parkinson's disease — what it is, which brain structures
degrade, and what that does to a real person's movement and daily life.
**Audience:** general public, students, and potential evaluators/judges
for a college engineering project — not clinicians, not patients seeking
medical advice.
**Primary job of the page:** make the *mechanism* of Parkinson's viscerally
understandable in under two minutes of scrolling, then hand off cleanly
into "here's the device we built in response to this."

This is a science-communication piece with one big idea, not a product
marketing site. Every design decision below is justified against that,
not against what a generic "cool 3D site" looks like.

---

## 2. Anti-patterns — do not do these

These are the tells of a generated page. If any of these appear anywhere
on this site, it's a bug, regardless of how it got there:

1. **The warm-cream-and-terracotta look** — a cream/off-white background
   (near `#F4F1EA`) paired with a high-contrast serif display and a warm
   clay/terracotta accent (near `#D97757`). This is a specific, recognized
   AI-default palette. Never use it.
2. **The near-black-plus-one-neon-accent look** — pure near-black
   background with a single bright acid-green or vermilion accent and
   nothing else. Also a recognized default.
3. **The SaaS-card kit** — content chopped into identical rounded cards,
   one border-radius applied everywhere regardless of hierarchy, the same
   soft grey drop shadow (`rgba(0,0,0,.1)`) under every card, gradient
   washes used purely as decoration.
4. **Template chrome**, regardless of subject:
   - Tracked-out ALL-CAPS eyebrow labels above every heading.
   - Meta strings joined with middle dots (`A · B · C`).
   - Labels styled as `WORD — fragment` with a spaced em dash.
   - Tinted near-black (`#0B0B0B`, `#111`) standing in for true black.
   - A monospace face used for small data labels for no functional reason.
   - A `→` arrow glued onto every link and button label.
5. **Bolding or coloring a single word in a headline** for emphasis
   instead of designing the whole line with intention.
6. **ALL CAPS used for labels** as a default styling choice.
7. **Numbered markers (01 / 02 / 03)** applied to content that isn't
   actually a sequence. This site *does* have real sequences (scroll
   stages, disease progression) — numbering is fine there. It is not fine
   glued onto, say, a grid of unrelated symptom facts just to look
   structured.
8. **Fade-and-slide-up-on-scroll applied to every section, plus a hover
   lift on every card.** This is the single most common AI-site motion
   signature. This project gets exactly **one** big orchestrated motion
   moment (the brain explode) — see §5. Everything else is close to
   static.
9. **Stock "neuron network" clip-art aesthetics** — glowing blue synapse
   wallpaper, generic DNA-helix decoration, or med-tech stock photography.
   If it looks like it came from a hospital brochure's stock library,
   it's wrong for this brief.
10. **Placeholder medical copy that sounds plausible but isn't checked.**
    Anatomical names, symptom descriptions, and prevalence claims must be
    verified against a real source before shipping, not generated to fit
    the sentence.

If you find yourself about to reach for any of the above because it's the
fastest path to "looks finished," that's the moment to stop and make an
actual decision instead.

---

## 3. Design system (the actual choices, not defaults)

### Color

Grounded in the subject: this is about a *specific* disease affecting a
*specific* brain structure (the substantia nigra, part of the basal
ganglia, which produces dopamine) — not generic "tech" or "medical."
Reach for the vernacular of neuroanatomy imaging and clinical illustration
rather than either a hospital-brochure palette or a sci-fi one.

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#14120F` | Primary text — a warm near-black, not tinted grey |
| `--paper` | `#EDE7DC` | Page background — a genuinely warm bone/paper tone, distinct from the AI-default cream by leaning more grey-warm and less peach |
| `--tissue` | `#B23A2E` | The one saturated accent — a deep, desaturated red-oxide, evoking stained tissue/anatomical illustration plates rather than a UI "brand color." Used sparingly: the substantia nigra highlight, one CTA, nothing else. |
| `--dopamine` | `#3E6E5E` | Secondary accent, a muted teal-green, used only for the "what's still working" / healthy-signal states, so the palette itself encodes the disease's contrast between degrading and intact systems |
| `--line` | `#C9C0AE` | Hairline dividers and structural rules, low-contrast on purpose |
| `--fog` | `#8A8474` | Muted secondary text (captions, metadata) |

Justification: the red-oxide and teal pairing is drawn directly from
histology/anatomical-plate coloring conventions (stained substantia nigra
tissue vs. surrounding healthy tissue), which ties the palette to the
actual subject matter instead of being an arbitrary "looks nice" choice.

### Type

Two families, clearly distinct roles:

- **Display / headline face:** a humanist serif with real editorial
  weight — something in the territory of *Fraunces* or *Newsreader* at a
  heavy optical size. This carries the page's one moment of typographic
  personality: the section headlines that narrate the scroll.
- **Body / UI face:** a plain, high-legibility grotesk — something like
  *Inter* or *Public Sans* — used for all running text, labels, and data.

Type scale: follow *The Elements of Typographic Style* defaults —
harmonic size steps (a ~1.25–1.333 ratio), generous but not excessive
leading, and real optical weight/width variation rather than relying on
color or caps for hierarchy. Body copy stays under 80 characters per
line; serif headline lines can run slightly longer since display serifs
read differently than continuous body text.

Do not accent a single word in a headline with italics/bold/color as a
substitute for actually composing the line. If a headline needs emphasis,
restructure the sentence or resize the whole line — don't spot-color one
word.

### Layout

Left-aligned, not centered. A centered, symmetrical layout reads as a
generic landing page; a left-aligned column with a strong vertical rhythm
reads more like an editorial science piece, which matches this brief
better than a marketing brief.

```
Hero (full viewport, pinned during scroll-explode)
┌──────────────────────────────────────────┐
│  NeuroLoop                                │  ← small, quiet wordmark, top-left
│                                            │
│         [ 3D brain, centered-right,       │
│           explodes as user scrolls ]      │
│                                            │
│  Headline (left column, ~40% width)       │
│  Sub-line                                 │
└──────────────────────────────────────────┘

Narrative section (below the fold, unpinned scroll)
┌──────────────────────────────────────────┐
│  01  Substantia nigra           [diagram] │
│      — what it normally does              │
├──────────────────────────────────────────┤
│  02  What degrades                [diagram]│
│      — dopamine loss, mechanism           │
├──────────────────────────────────────────┤
│  03  What that causes in the body [diagram]│
│      — tremor, rigidity, bradykinesia,    │
│        postural instability, freezing     │
└──────────────────────────────────────────┘

Device section (transition to the actual project)
┌──────────────────────────────────────────┐
│  Long-form paragraph, no card grid        │
│  → link to device docs / demo             │
└──────────────────────────────────────────┘
```

Numbering (`01 / 02 / 03`) is justified here because the narrative
section *is* a real sequence — substantia nigra function → what degrades
→ resulting symptoms — a genuine causal chain, not decoration.

### Structural devices

- A single hairline rule (`--line`) separates narrative stages; no card
  borders, no drop shadows, no border-radius applied indiscriminately.
- Diagrams are simple, labeled line illustrations in the `--ink` /
  `--tissue` / `--dopamine` palette — not photographic, not glossy 3D
  renders competing with the hero brain for visual weight.

---

## 4. The 3D brain hero — concept and technical approach

### Concept

On page load, a rotating, low-poly-but-anatomically-recognizable brain
model sits centered. As the visitor scrolls, the model:

1. **Stage 0 (0–15% scroll):** brain rotates slowly, intact, no explosion
   yet — establishes the object before disturbing it.
2. **Stage 1 (15–55% scroll):** the model separates along real anatomical
   boundaries — cerebrum, cerebellum, brainstem — drifting apart in 3D
   space, each labeled as it separates.
3. **Stage 2 (55–85% scroll):** camera pushes into the separated brainstem
   / basal ganglia region; the substantia nigra is isolated and
   highlighted in `--tissue`, visibly diminished/faded relative to a
   healthy reference shown alongside in `--dopamine`, directly
   illustrating dopamine-producing cell loss.
4. **Stage 3 (85–100% scroll):** the isolated substantia nigra view holds,
   and the headline for the narrative section fades in underneath,
   handing off from 3D to the scroll-driven text sections in §3's layout.

Scrolling back up should reverse this smoothly — it's a scrubbed
animation tied to scroll position, not a one-shot autoplay.

### Why this concept, not a generic alternative

A generic "3D hero" default would be an abstract rotating blob or a
low-poly wireframe head with no anatomical specificity — that would be
interchangeable with any tech product's hero. Tying the explode sequence
to *actual anatomical separation*, ending specifically on the substantia
nigra (the structure Parkinson's degrades), makes the 3D moment
inseparable from this exact subject. It couldn't be reused for another
project without the anatomy being wrong.

### Technical approach

- **Rendering:** WebGL via `three.js`. Use a real (simplified, low-poly)
  brain glTF/GLB model with named mesh groups per anatomical region so
  each region can be independently transformed — do not fake the
  "explode" with a single mesh split by shader trickery alone.
- **Scroll binding:** drive animation progress from scroll position
  (e.g. via `ScrollTrigger` from GSAP, or an equivalent scrubbed-timeline
  approach) rather than scroll-triggered one-shot CSS animations — the
  brain's state must be a direct, reversible function of scroll position,
  not a play-once trigger.
- **Camera:** animate camera position/target through the stages rather
  than only moving the model — a push-in on stage 2 reads as more
  intentional than just scaling the whole scene.
- **Labels:** anatomical labels as HTML overlays positioned via
  projected 3D coordinates (project the 3D anchor point to 2D screen
  space each frame), not baked into the 3D scene as flat textures — this
  keeps them crisp at any zoom and translatable/localizable later.

### Performance budget (mobile is not optional)

- Target 60 fps on a mid-range 2023-era phone GPU; degrade gracefully
  rather than fail:
  - Cap device pixel ratio (e.g. `Math.min(devicePixelRatio, 2)`).
  - Use a genuinely low-poly model (aim under ~50k triangles total across
    all separated pieces) — this is a stylized illustration, not a
    medical-grade volumetric render.
  - Lazy-load the 3D scene only once it's near-viewport; show a static
    fallback image of the intact brain until the WebGL context is ready.
- **Reduced-motion fallback:** if `prefers-reduced-motion` is set, replace
  the scroll-scrubbed 3D sequence with a small number of static states
  (intact → separated → substantia nigra highlighted) that advance on
  scroll without continuous animation, rather than disabling the section
  entirely — the content still needs to get across.
- **No-WebGL fallback:** detect WebGL support; if unavailable, show the
  same three key states as static labeled illustrations in sequence
  instead of a blank hero.

---

## 5. Motion rules for the whole site

- **One orchestrated moment: the brain explode.** That's the site's
  entire motion budget for anything non-interactive. Everything below the
  hero is close to static.
- No fade-and-slide-up entrance on each narrative section. Sections
  should simply be present when scrolled to, or use at most a very quick,
  subtle opacity settle (under ~150ms) — nothing that reads as a
  "reveal."
- No hover-lift/shadow-pop on every card, because there shouldn't be
  "cards" in the SaaS sense at all in the narrative section (see layout,
  §3) — just labeled text blocks and diagrams separated by hairlines.
- Motion that responds to a person's direct action (scrolling controls
  the brain explode; expanding a diagram's detail on click/tap) is
  welcome. Motion that plays at the page regardless of what the person is
  doing is not.

---

## 6. Content rules — the narrative section

The Parkinson's-impact section must be medically accurate, not
plausible-sounding placeholder copy. At minimum, before shipping:

- Verify the role of the **substantia nigra** and **basal ganglia** in
  motor control and dopamine production against a real source.
- Verify the standard core motor symptom list — **tremor, rigidity,
  bradykinesia (slowness of movement), postural instability, and freezing
  of gait** — rather than inventing or reordering it.
- Do not state prevalence, progression-rate, or treatment claims without
  a source. If a fact can't be verified while building this, cut it
  rather than approximate it.
- Keep language plain and specific. Say what a symptom actually looks
  like in daily life (e.g. difficulty initiating the first step when
  starting to walk) rather than clinical jargon alone — this is a public
  explainer, not a textbook page.
- No sentimentalizing or dramatizing a patient's experience for effect.
  Describe mechanism and impact factually; let the facts carry the
  emotional weight rather than the copy reaching for it.

---

## 7. Quality floor (non-negotiable regardless of time pressure)

- Responsive down to a small phone viewport — the 3D hero must have a
  working reduced/no-WebGL fallback (§4), not just "looks fine at
  1440px."
- Visible keyboard focus states on every interactive element.
- Color contrast: body text on `--paper` and `--ink` combinations must
  meet at least WCAG AA for normal text.
- `prefers-reduced-motion` respected as specified in §4.
- The palette in §3 is used consistently — no ad hoc colors introduced
  per-section.

---

## 8. Self-critique checklist before calling this done

Before shipping, check the live page against this list — if any answer is
"yes," go back and fix it:

- [ ] Does any section use the cream/terracotta or near-black/neon-accent
      default palette instead of the tokens in §3?
- [ ] Is there a card grid with identical rounded corners and matching
      drop shadows anywhere in the narrative section?
- [ ] Does any heading use an ALL-CAPS eyebrow label, a middle-dot meta
      string, or a spaced-em-dash label?
- [ ] Does more than one element on the page animate on scroll besides
      the brain hero and its handoff into the narrative section?
- [ ] Could the 3D hero be swapped onto an unrelated tech product's
      landing page without looking wrong? (If yes, it isn't specific
      enough to this subject yet.)
- [ ] Has every anatomical or symptom claim in the copy been checked
      against a real source rather than written to sound plausible?

If every box is unchecked, the page is doing what this brief actually
asked for.
