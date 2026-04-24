# Harmonic Field Reports

A civic legibility project. Structured-data and editorial audits of Hudson Valley
places, maintained by a local practitioner. Kinderhook is the prime example.

## What this is

An inductive project. We build one village — Kinderhook — as a deep, opinionated,
machine-legible atlas. The method (schema, tooling, editorial posture) emerges
from that work and gets extracted later. Do not generalize prematurely.

Each "Field Report" is a public audit + augmentation of a place. It reads live
from the public WordPress REST API of the relevant tourism board, overlays local
knowledge the tourism board cannot encode (functional proximity, seasonality,
affective register, cultural orbit), and publishes schema.org JSON-LD that
machines can actually read.

## Maintainer

David — speech-language pathologist, resident of Kinderhook NY, principal of
Harmonic Systems. Project is professional, not volunteer. Tone is editorial,
restrained, warm, and unshowy. Think municipal design manual × The Pudding.

## Posture

- Augmentation, not replacement. The county tourism site is a primary source we
  cite via `sameAs`, never a competitor.
- Correctable and correct, in that order. Every claim is legibly authored and
  open to update.
- OK > perfect. Ship the v1, iterate in public, document the calls.
- Local epistemology at scale — the product is judgment encoded as data.

## Stack

- Astro (content collections, static build, MDX)
- Vanilla CSS with design tokens (see `src/styles/tokens.css`)
- Fonts: Fraunces (display) + EB Garamond (body) + JetBrains Mono (data).
  Do not substitute. They are the voice of the publication.
- No Tailwind. No shadcn. No component libraries. Typography and grid do the work.
- Deploy: (TBD — Vercel or Netlify)

## Directory

- `sites/kinderhook/` — the prime-example field report
- `schema/` — documented ontology, namespaced extensions, hand-curated places
- `data/snapshots/` — dated JSON pulls from CCT's API, for diffing over time
- `tools/` — scripts that re-run audits and regenerate JSON-LD
- `method.md` — the project essay; the philosophy written down

## Aesthetic rules

- No cards with drop shadows and rounded corners. Use plates, rules, columns.
- No emojis, no icons except minimal pictographs if absolutely needed.
- Section marks (§I, §II) for structure. Small caps for labels. Real italics
  for tone, not for emphasis.
- Cream background `#f4efe4`, ink `#1a1614`, cinnabar accent `#a63d2a`,
  slate `#4a5a4e`. Avoid pure white and pure black.
- Nothing that looks like a SaaS dashboard. If a section feels like Stripe or
  Linear, stop and rework it.

## Ontology principles

- Use schema.org where it fits. Extend with `kh:` namespace where it doesn't.
- Consistency within the corpus beats correctness against the spec.
- Every decision gets a line in `schema/ontology.md` with a short rationale.
- The hard cases (cidery = Winery + additionalType:Restaurant, market = Event
  + Organization + Place linked) are documented calls, not special cases.

## Writing voice

- Editorial, unhurried, warm. Never marketing-speak.
- The project is not selling; it is describing.
- "Correct" is the highest praise. "Legible" is the core value.
- First-person plural ("we read", "we publish") for the publication voice;
  never first-person singular except in signed editor's notes.

## Do not

- Do not substitute fonts, colors, or design tokens without updating this file.
- Do not add third-party trackers or analytics. The project's posture is
  incompatible with surveillance.
- Do not scrape anything that isn't already exposed via a public API.
- Do not invent facts about entities. If we don't know, we don't publish.
- Do not generalize the method into a framework until Kinderhook is complete.