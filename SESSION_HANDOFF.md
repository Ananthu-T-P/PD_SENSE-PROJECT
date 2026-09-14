# SESSION_HANDOFF.md — Between-Session Context

**Purpose:** AI sessions have no memory between conversations. This file bridges that gap — fill it in at the END of every session so the NEXT session can pick up exactly where you left off without re-explaining everything. Overwrite the previous entry each time; only the latest state matters here (history is in git + error-log.md).

---

## Current State (update this after every session)

**Date of last session:**
**AI tool used:**
**Module worked on:**
**Files changed:**

---

## What Was Done This Session

*(2–4 sentences: what was built, what decisions were made, what was tested)*

---

## What Was NOT Finished (carry forward)

*(Anything started but not completed — specific functions, failing tests, open questions)*

---

## Exact Next Task for Next Session

*(Be specific enough that an AI session can start without asking clarifying questions)*

Example:
> "Implement Vec3.h in foundation/math/ — a 3D vector type with dot product, cross product, normalize, and length. Direction-vector conversion functions from Angles.h go here (see CLAUDE.md for scope). Use the shared tolerance constant from Tolerance.h for equality comparisons. Output format: full implementation + unit tests with hand-checkable expected values."

---

## Open Questions / Blockers

*(Anything unresolved that needs a decision before the next session can fully proceed)*

---

## Files to Re-Upload to AI Session

At minimum, always paste these at the start of the next session:
- [ ] `PROJECT_OVERVIEW.md`
- [ ] `EYE_Kernel_Master_Spec.md`
- [ ] `CLAUDE.md`
- [ ] `CODE_STYLE_AND_ARCHITECTURE.md`
- [ ] `NAMING_CONVENTIONS.md`
- [ ] The specific module files being worked on

Optional but useful if relevant:
- [ ] `PICOGK_STUDY_NOTES.md` (if a geometry module is starting)
- [ ] `MODULE_TRACKER.md` (so the AI knows what's frozen and what isn't)
- [ ] `docs/error-log.md` (if recent bugs might be relevant to the next task)

---

## Last Frozen Module

**Module:** *(e.g. foundation/math/Tolerance.h)*
**Git tag:** *(e.g. phase0-tolerance-frozen)*
**Date frozen:** 
