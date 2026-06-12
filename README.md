# field-report

The Kinderhook Field Report — a civic legibility audit of the Village of
Kinderhook, NY, published at
[fieldreports.harmonic-systems.org](https://fieldreports.harmonic-systems.org).
The canonical artifact is [`kinderhook.json`](https://fieldreports.harmonic-systems.org/kinderhook.json),
a schema.org JSON-LD graph rebuilt weekly from public sources plus the
hand-curated corpora in `schema/`.

## AI surface audit — the monthly workflow

`schema/audit/` tracks what AI surfaces (Google AI Overviews, map
assistants, Claude, ChatGPT) claim about the village, diffed against this
repo's canonical data. Collection is manual by design — no scraping, no
SERP APIs, no headless browsers. Rendered at
[`/ai-audit.html`](https://fieldreports.harmonic-systems.org/ai-audit.html).

Once a month:

1. **Run the queries.** Ask each query in `schema/audit/queries.json`,
   verbatim, on each surface.
2. **Fill the template.** One copy of `schema/audit/TEMPLATE.md` per
   observation, by hand, while the answer is on screen.
3. **Transcribe to the cycle file.** Append entries to
   `schema/audit/cycles/YYYY-MM.json` (create it from the previous
   month's shape; field mapping is at the bottom of the template).
4. **Validate and rebuild.**
   `node tools/validate-audit.mjs` — fix anything it flags, then
   `node tools/build-audit-page.mjs && node tools/build-jsonld.mjs`.
   `ai-audit.html` is generated; never hand-edit it.
5. **Commit.** The site updates on push; cycle-level stats land in
   `kinderhook.json` under the top-level `audit` block.
6. **Fix at source.** Corrections go to the canonical corpora
   (`schema/places/`, `schema/hours/`) or the stale upstream page —
   never into the audit entries themselves. Flip the entry's `status`
   to `fixed-at-source` in a follow-up commit.
7. **Verify next cycle.** When a later run shows the surface answering
   correctly, flip to `verified-resolved` and set `resolved_at`.

The entry schema is v0-provisional (`schema_version: 0.1`); the first
real cycle is expected to revise it. Modeling decisions are recorded in
`schema/ontology.md`.
