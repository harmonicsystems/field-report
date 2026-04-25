# Ontology

Documented calls for the Kinderhook corpus. Kept short. Every non-obvious
decision gets one entry.

## Principle

Use schema.org where it fits. Extend with `kh:` where it doesn't. Consistency
within the corpus beats correctness against the spec.

## The `kh:` namespace

Base IRI: `https://fieldreports.harmonic-systems.org/ns/kh#`

Declared in each document's `@context`:

```json
"@context": [
  "https://schema.org",
  { "kh": "https://fieldreports.harmonic-systems.org/ns/kh#" }
]
```

### Properties

| Property | Domain | Range | Purpose |
|---|---|---|---|
| `kh:functionalProximity` | `Place` | prose | Real travel from the village green, in minutes, not miles. |
| `kh:seasonality` | `Place` / `Event` | object | When the place is *alive*, not just when it's open. |
| `kh:affectiveRegister` | `Place` / `Event` / `CreativeWork` | prose | What it *feels like*. One sentence, editorial voice. |
| `kh:culturalOrbit` | `Place` / `Event` | array of `@id` | Other corpus entities that cluster with this one. |
| `kh:localNotes` | any | array of dated prose | Editorial record. Appended to over time, never rewritten silently. |

### Seasonality object

```json
"kh:seasonality": {
  "season": "May–October",
  "cadence": "Saturdays 09:00–13:00",
  "dormantMonths": ["November", "December", "January", "February", "March", "April"]
}
```

`dormantMonths` is explicit because "closed for the season" is a positive
fact, not an absence.

## File layout

One JSON file per place at `schema/places/{slug}.json`. Slugs mirror the
CCT site's slug where one exists, so cross-references by URL remain
obvious. Each file has the shape:

```json
{
  "slug": "kinderhook-farmers-market",
  "editor": "david@harmonic-systems.org",
  "lastReviewed": "2026-04-24",
  "jsonld": { "@context": [...], "@graph": [...] }
}
```

The wrapper is local metadata (who curated, when it was last verified).
The graph inside `jsonld` is what gets published to machines.

## Hard cases

Documented calls, not special cases.

### Farmers' market → `Event` + `Organization` + `Place`, linked

A seasonal market is three entities. The `Event` is the recurring Saturday
session. The `Organization` is the body that runs it (KBPA for Kinderhook).
The `Place` is where it physically happens (the village green). Each gets
its own `@id`; they reference each other with `organizer`, `location`,
`subjectOf`.

Rationale: collapsing to a single `Event` loses the organizer as a
reachable entity. Collapsing to a single `Place` loses the recurrence.

### Cidery → `Winery` + `additionalType: Restaurant`

Not yet instantiated (no Kinderhook-village cidery in scope). Recorded
here so the call is remembered.

### Restaurant in a historic building → two linked `Place`s

The restaurant is a `Restaurant` entity. The building is a separate
`Place` with `@type: [Place, LandmarksOrHistoricalBuildings]`. The
restaurant's `containedInPlace` points at the building. The building
carries its own history independent of whoever currently occupies it.

Example: The Aviary is a Restaurant inside the Kinderhook Knitting Mill.
The Mill outlives any particular tenant.

### Gravesite of a notable person → `Place` + `Person`, linked

The grave is a `Place` (subtype `Cemetery` if standalone; otherwise a
named location within one). The person is a `Person` entity, ideally
with a Wikidata `sameAs`. The grave links to the person via
`subjectOf` or `about`.

Example: Martin Van Buren's grave at Kinderhook Reformed Cemetery links
to Van Buren's Wikidata item `Q11817`.

## Identifiers

Every `@id` in this corpus must resolve to a real, dereferenceable URL.
We do not mint identifiers for things the commons already names; we do
not invent URL patterns whose pages don't exist. The rules:

- **The village itself** is `https://www.wikidata.org/wiki/Q3478629`.
  Wikidata is the canonical record; we describe Q3478629, we don't
  rename it. Every `containedInPlace` reference to the village resolves
  to a real Wikidata page.

- **Curated places we maintain** use the file URL of their JSON-LD as
  `@id`. The Aviary, for example, is
  `https://fieldreports.harmonic-systems.org/schema/places/the-aviary.json`.
  The file IS the entity's representation; fetching it returns the
  JSON-LD that describes it. No invented URL pattern, no 404.

- **Sub-entities defined within a curated file** (e.g., the Knitting
  Mill described inside `the-aviary.json`) use a fragment within that
  file's URL: `…/the-aviary.json#kinderhook-knitting-mill`. Standard
  JSON-LD pattern. The fragment ID is a slug.

- **Cross-references to entities we have not yet curated** (e.g.,
  `ok-pantry` mentioned from `the-aviary.json` before its file exists)
  use the file URL the entity *will* live at:
  `…/schema/places/ok-pantry.json`. The reference resolves the moment
  someone creates the file. This is forward-compatible, not invented.

- **Entities owned by other authorities** (CCT venues, CCT events,
  Wikipedia-described people, NRHP sites) use the authority's URL
  directly. We're consumers of those identifiers, not minters. CCT's
  `https://columbiacountytourism.org/venue/village-yoga/` is what
  Village Yoga's `@id` should be.

The earlier draft of this section described an invented pattern under
`/kinderhook/places/{slug}` etc. That pattern was abandoned: those URLs
did not resolve, so the JSON-LD was making structural promises the
deploy could not keep.

## What we do not model

- Phone numbers and hours we cannot verify from a public primary source.
- Menu items, prices, vendor lists — volatile and not our job.
- Sentiment or "rating" fields. We describe, we do not rank.
