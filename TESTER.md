# TESTER.md — Testing Protocol

Purpose: a repeatable process to verify any file or module is correct, usable by a non-coder because pass/fail is judged by test results and visuals, not by reading C++/C#.

---

## 1. Every Function Needs

- [ ] At least one unit test with a **hand-checkable expected value** (not just "doesn't crash"). Example: "union of two unit spheres 1mm apart → expected volume = X mm³, computed by hand or with an independent tool."
- [ ] At least one **edge case test**: zero/empty input, maximum/extreme input, coincident or overlapping geometry, tangent surfaces.
- [ ] A plain-English one-line description of what the test proves, written above the test code.

---

## 2. Every Module Needs (before it's frozen)

- [ ] All unit tests passing
- [ ] A **visual check**: run the operation through the viewer, confirm it looks correct, not just numerically "passing" (see `PICOGK_COMPARISON.md` for comparison-based checks)
- [ ] A **cross-validation check**: same operation run through PicoGK/OpenVDB, compare volume/surface area/vertex count within tolerance
- [ ] A **fuzz test pass**: random/extreme inputs thrown at the module without crashing or producing nonsense output (negative volume, NaN, exploded geometry)
- [ ] No test was skipped, weakened, or deleted to make the suite pass

---

## 3. How a Non-Coder Verifies "Done"

You don't need to read the implementation. You need to confirm:

1. **Test output is green** — every test in the module's test file passes.
2. **The AI explained each test in plain English** — if you don't understand what a test is checking, ask it to explain before accepting.
3. **The viewer shows the expected shape** — if a boolean union of two spheres looks broken, disconnected, or has holes, it's broken regardless of test results.
4. **The cross-validation numbers are close** — if your kernel's sphere union volume differs from PicoGK's by more than a small tolerance, something is wrong.
5. **Nothing was silently skipped** — explicitly ask: "did any test get skipped, commented out, or have its expected value loosened to pass?"

---

## 4. Test Types Reference

| Type | What it catches | Required for |
|------|------------------|----------------|
| Hand-checkable unit test | Basic correctness | Every function |
| Edge case test | Boundary failures | Every function |
| Visual check | Errors that look wrong but pass numerically | Every geometry-producing module |
| Cross-validation vs PicoGK | Silent divergence from correct behavior | Every module before freeze |
| Fuzz test | Crashes/undefined behavior on unusual input | Every module before freeze |

---

## 5. When a Test Fails

1. Don't let AI "fix" the test to pass — the code must be fixed, or the expected value must be independently re-verified as wrong.
2. Log it in `docs/error-log.md` (module, symptom, root cause, fix, new test added).
3. Re-run the full module's test suite after any fix, not just the failing test — fixes can break other things.
