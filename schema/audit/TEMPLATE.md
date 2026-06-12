# AI surface observation — capture template

Copy this block once per observation during a monthly audit session. Fill it
in by hand while the answer is on screen, then transcribe the session's blocks
into `schema/audit/cycles/YYYY-MM.json` (see field mapping at the bottom).
Do not build tooling around this; the template is the intake.

---

```
QUERY        (verbatim, from queries.json — note the query id)
  id:        q-
  asked as:

SURFACE      (google-aio | ask-maps | claude | chatgpt | other)
  surface:
  date:      YYYY-MM-DD

ANSWER       (verbatim or near-verbatim; mark paraphrase with ~)


SOURCES      (URLs the surface cited or linked, one per line; "none shown")


ASSESSMENT   (accurate | factual-error | omission | narrative-gap)
  call:

DISCREPANCY  (what the answer got wrong or left out, against which
              canonical file; skip if accurate)


ENTITY       (canonical slug(s) the answer is about, if any)

TRACED TO    (the stale/wrong upstream page, if you can find it)

FIX          (what was corrected at the source, if anything yet)

STATUS       (open | fixed-at-source | verified-resolved)
```

---

## Transcribing to the cycle file

One JSON entry per block, appended to `entries` in `cycles/YYYY-MM.json`:

| Template line | JSON field        | Notes |
|---|---|---|
| QUERY id      | `query_id`        | must exist in `queries.json` |
| —             | `id`              | mint as `YYYY-MM-<query_id>-<surface>` |
| SURFACE       | `surface`         | enum above |
| date          | `observed_at`     | `YYYY-MM-DD` |
| ANSWER        | `observed_answer` | verbatim beats summary |
| SOURCES       | `cited_sources`   | array of URLs, `[]` if none shown |
| ASSESSMENT    | `assessment`      | enum above |
| DISCREPANCY   | `discrepancy`     | omit for `accurate` |
| ENTITY        | `entity_ref`      | one slug; must exist in `schema/places/` or `schema/hours/` manifests |
| TRACED TO     | `traced_source`   | URL or `null` |
| FIX           | `fix_applied`     | prose or `null` |
| STATUS        | `status`          | omit for `accurate` entries; `verified-resolved` requires `resolved_at` |

After transcribing: `node tools/validate-audit.mjs`, fix what it flags,
`node tools/build-audit-page.mjs && node tools/build-jsonld.mjs`, commit.

Statuses move in later commits as fixes land: `open` → `fixed-at-source`
(correction made upstream or in our corpus) → `verified-resolved` (a later
query shows the surface now answers correctly; set `resolved_at`).
