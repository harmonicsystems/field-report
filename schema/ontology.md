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

All Kinderhook `@id`s follow:

```
https://fieldreports.harmonic-systems.org/kinderhook/places/{slug}
https://fieldreports.harmonic-systems.org/kinderhook/people/{slug}
https://fieldreports.harmonic-systems.org/kinderhook/events/{slug}
```

These are permanent. If we later split the report into multiple
deployments, the IDs stay; only the hosting changes.

## What we do not model

- Phone numbers and hours we cannot verify from a public primary source.
- Menu items, prices, vendor lists — volatile and not our job.
- Sentiment or "rating" fields. We describe, we do not rank.
