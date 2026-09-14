# Agent scope: Public Project Website

Full spec: [`../website/WEBSITE.md`](../website/WEBSITE.md). Read that file
in full before writing any code for this piece — it contains the design
system, the scroll-sequence spec, and hard rules against generic
AI-generated-website patterns that apply to every visual decision here.

## You own

- The standalone public/marketing website for the NeuroLoop project: the
  scroll-driven 3D brain hero, the "problems Parkinson's causes" narrative
  section that follows it, and everything else `WEBSITE.md` scopes in.

## You do NOT own

- The local dashboard (`dashboard-agent.md`) or the doctor website
  (`doctor-website-agent.md`). This site does not talk to the ESP32, does
  not show live patient data, and does not authenticate a doctor. It is a
  public explainer/showcase site — content and 3D model only, no device
  connection.
- Any real patient data. All content here is educational/illustrative.

## Hard constraints

1. **Follow `WEBSITE.md`'s design system exactly** — the palette, type
   scale, and layout decisions in that file are deliberate choices for
   this subject, not suggestions. Do not fall back to default AI-generated
   web patterns (see the "Anti-patterns" section of `WEBSITE.md`) even if
   they'd be faster to implement.
2. **The scroll sequence is the centerpiece; everything else stays quiet.**
   One orchestrated brain-explode moment on scroll, not scroll-triggered
   fades on every subsequent section. Motion elsewhere on the page should
   be minimal and purposeful.
3. **Performance on mobile is not optional.** A 3D scroll site that only
   works on a desktop GPU has failed its brief — see `WEBSITE.md`'s
   performance section for concrete budgets and fallback behavior.
4. **Medical accuracy over stylization.** When depicting brain regions
   affected by Parkinson's (substantia nigra, basal ganglia) or listing
   symptoms, the content must be factually correct even where the visual
   treatment is stylized. Verify claims rather than writing plausible-
   sounding placeholder medical copy.

## Definition of done for this piece

- Scrolling into the hero smoothly explodes the 3D brain model into
  labeled layers/regions and scrolling back reassembles it, at a usable
  frame rate on a mid-range phone.
- Continuing to scroll transitions into the Parkinson's-impact narrative
  section with the specific structural device chosen in `WEBSITE.md` (not
  a generic fade-up card grid).
- No visual or copy pattern from `WEBSITE.md`'s anti-pattern list appears
  anywhere on the page.
