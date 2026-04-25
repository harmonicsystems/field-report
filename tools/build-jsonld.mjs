#!/usr/bin/env node
/*
 * build-jsonld.mjs
 *
 * Assembles the canonical Kinderhook JSON-LD graph from every snapshot
 * and curated file in the repository, and writes it to /kinderhook.json
 * at the repo root. That file is the single addressable JSON-LD document
 * for the village — what an AI assistant or search engine should fetch
 * when it wants this report's structured data in one piece.
 *
 * Mirrors the graph construction in index.html's renderGeneratedSchema()
 * so the on-page §XII display and the file at /kinderhook.json are the
 * same graph. The page is the human-rendered view; the file is the
 * machine view.
 *
 * Usage: node tools/build-jsonld.mjs
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const TOWN = 'kinderhook';
const OUT = resolve(REPO_ROOT, 'kinderhook.json');

const PLACE = {
  wikidata: ['Q3478629', 'Q3710663'],
  wikipedia: 'Kinderhook_(village),_New_York',
  officialSite: 'https://www.villageofkinderhook.org/',
};

// The village's canonical @id is its Wikidata entity. We're describing
// Q3478629; we're not minting a new identifier for a place the commons
// already named. Every "containedInPlace" reference to the village
// resolves to a real, machine-readable Wikidata page.
const VILLAGE_ID = `https://www.wikidata.org/wiki/${PLACE.wikidata[0]}`;

async function readJson(rel, fallback = null) {
  try {
    return JSON.parse(await readFile(resolve(REPO_ROOT, rel), 'utf-8'));
  } catch {
    return fallback;
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function main() {
  // --- snapshot inputs ---
  const events     = await readJson('data/snapshots/columbiacountytourism/latest-events.json');
  const venues     = await readJson('data/snapshots/columbiacountytourism/latest-venues.json');
  const osmSnap    = await readJson('data/snapshots/openstreetmap/latest-kinderhook-features.json');
  const histSites  = await readJson('data/snapshots/wikidata/latest-kinderhook-historic-sites.json');
  const histPeople = await readJson('data/snapshots/wikidata/latest-kinderhook-historic-people.json');
  const orptsParcels = await readJson('data/snapshots/orpts/latest-parcels.json');
  const orptsRar     = await readJson('data/snapshots/orpts/latest-rar.json');
  const marketEquity = await readJson('data/snapshots/nysales/latest-equity.json');
  const acsVillage   = await readJson('data/snapshots/acs/latest-village.json');
  const acsTown      = await readJson('data/snapshots/acs/latest-town.json');
  const fema         = await readJson('data/snapshots/fema/latest-disasters.json');
  const hoursManifest = await readJson('schema/hours/manifest.json', { businesses: [] });

  // --- curated corpora ---
  const placesManifest = await readJson('schema/places/manifest.json', { places: [] });
  const curatedPlaces = await Promise.all(
    placesManifest.places.map(async p => readJson(`schema/places/${p.slug}.json`))
  );
  const coverageManifest = await readJson('schema/coverage/manifest.json', { entries: [] });
  const coverageEntries = await Promise.all(
    coverageManifest.entries.map(async e => readJson(`schema/coverage/${e.slug}.json`))
  );

  // --- venue + event match (matches the page's logic exactly) ---
  const allVenues = (venues?.venues) || [];
  const khVenues = allVenues.filter(v => {
    const hay = [v.venue, v.city, v.address, v.description].join(' ').toLowerCase();
    return hay.includes(TOWN);
  });
  const primaryVenue = khVenues.find(v => (v.venue || '').toLowerCase().includes('market')) || khVenues[0];

  const allEvents = (events?.events) || [];
  const khEvents = allEvents.filter(e => {
    const blob = (e.venue?.city || '') + ' ' + (e.venue?.venue || '') + ' ' + (e.title || '') + ' ' + (e.description || '');
    return blob.toLowerCase().includes(TOWN);
  });
  const primaryEvent = khEvents[0];

  // OSM match for the primary venue.
  const osm = (osmSnap?.features || []);
  const venueOsm = primaryVenue
    ? osm.find(o =>
        norm(o.name) === norm(primaryVenue.venue)
        || norm(o.name).includes(norm(primaryVenue.venue))
        || norm(primaryVenue.venue).includes(norm(o.name)))
    : null;

  // --- assemble the graph ---
  const graph = [];

  // 1. Village Place itself.
  graph.push({
    "@type": "Place",
    "@id": VILLAGE_ID,
    "name": TOWN.charAt(0).toUpperCase() + TOWN.slice(1),
    "alternateName": TOWN === 'kinderhook' ? ["Kinderhoeck", "Old Kinderhook"] : [],
    "containedInPlace": {
      "@type": "AdministrativeArea",
      "name": "Columbia County",
      "sameAs": "https://www.wikidata.org/wiki/Q245071",
    },
    "sameAs": [
      PLACE.officialSite,
      ...PLACE.wikidata.map(q => `https://www.wikidata.org/wiki/${q}`),
      `https://en.wikipedia.org/wiki/${PLACE.wikipedia}`,
      `https://columbiacountytourism.org/?s=${TOWN}`,
    ].filter(Boolean),
  });

  // 2. Primary venue Place (if any). Use the venue's CCT URL as @id —
  //    that's where the entity is described authoritatively.
  if (primaryVenue) {
    const venueId = primaryVenue.url
      || `https://columbiacountytourism.org/venue/${(primaryVenue.slug || (primaryVenue.venue || 'place').toLowerCase().replace(/[^a-z]+/g, '-'))}/`;
    graph.push({
      "@type": "Place",
      "@id": venueId,
      "name": primaryVenue.venue,
      "address": {
        "@type": "PostalAddress",
        "streetAddress": primaryVenue.address || "",
        "addressLocality": primaryVenue.city || TOWN.charAt(0).toUpperCase() + TOWN.slice(1),
        "addressRegion": primaryVenue.state || "NY",
        "postalCode": primaryVenue.zip || "",
        "addressCountry": "US",
      },
      "containedInPlace": { "@id": VILLAGE_ID },
      "sameAs": [
        primaryVenue.url,
        venueOsm ? `https://www.openstreetmap.org/${venueOsm.type}/${venueOsm.id}` : null,
      ].filter(Boolean),
      ...(venueOsm?.lat && venueOsm?.lon ? {
        "geo": { "@type": "GeoCoordinates", "latitude": venueOsm.lat, "longitude": venueOsm.lon },
      } : {}),
    });
  }
  const venueId = primaryVenue?.url
    || (primaryVenue ? `https://columbiacountytourism.org/venue/${(primaryVenue.venue || 'place').toLowerCase().replace(/[^a-z]+/g, '-')}/` : null);

  // 3. Primary upcoming event (if any). @id is CCT's canonical URL for the event.
  if (primaryEvent) {
    graph.push({
      "@type": "Event",
      "@id": primaryEvent.url,
      "name": primaryEvent.title,
      "startDate": primaryEvent.start_date,
      "endDate": primaryEvent.end_date,
      "eventStatus": "https://schema.org/EventScheduled",
      "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
      ...(venueId ? { "location": { "@id": venueId } } : {}),
      ...(primaryEvent.organizer?.[0] ? {
        "organizer": { "@type": "Organization", "name": primaryEvent.organizer[0].organizer },
      } : {}),
      "description": (primaryEvent.excerpt || primaryEvent.description || '').replace(/<[^>]+>/g, '').slice(0, 300),
    });
  }

  // 4. Curated places — fold each entry's @graph in.
  for (const c of curatedPlaces.filter(Boolean)) {
    for (const node of (c.jsonld?.['@graph'] || [])) graph.push(node);
  }

  // 5. Independent journalism (article entries; search entries excluded).
  for (const c of coverageEntries.filter(c => c && c.type === 'article')) {
    graph.push({
      "@type": "NewsArticle",
      "@id": c.url,
      "headline": c.title,
      "url": c.url,
      ...(c.author ? { "author": { "@type": "Person", "name": c.author } } : {}),
      ...(c.publication ? { "publisher": { "@type": "Organization", "name": c.publication, ...(c.publicationUrl ? { "url": c.publicationUrl } : {}) } } : {}),
      ...(c.datePublished ? { "datePublished": c.datePublished } : {}),
      ...(c.summary ? { "abstract": c.summary } : {}),
      "about": { "@id": VILLAGE_ID },
      "isAccessibleForFree": true,
    });
  }

  // 6. Top 15 historic sites.
  for (const s of (histSites?.sites || []).slice(0, 15)) {
    graph.push({
      "@type": "Place",
      "@id": s.wikipedia || `https://www.wikidata.org/wiki/${s.qid}`,
      "name": s.name,
      ...(s.description ? { "description": s.description } : {}),
      ...(s.nrhp ? { "identifier": { "@type": "PropertyValue", "propertyID": "NRHP", "value": s.nrhp } } : {}),
      ...(s.inception ? { "dateCreated": s.inception.slice(0, 10) } : {}),
      "containedInPlace": { "@id": VILLAGE_ID },
      "sameAs": [s.wikipedia, `https://www.wikidata.org/wiki/${s.qid}`].filter(Boolean),
    });
  }

  // 6.5. LocalBusiness entities — every business in schema/hours/ becomes a
  //      schema.org LocalBusiness with structured openingHoursSpecification.
  //      The corpus is hand-curated; @id is a fragment in this graph (the
  //      kinderhook.json file itself), so other nodes can reference it.
  const dayMap = { Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday' };
  // Provisional entries are unverified placeholders; we render them on the
  // page (with a banner) but exclude them from the published JSON-LD so the
  // graph carries no invented facts.
  const verifiedBusinesses = (hoursManifest.businesses || []).filter(b => !b.provisional);
  for (const b of verifiedBusinesses) {
    const node = {
      "@type": b.type || 'LocalBusiness',
      "@id": `https://fieldreports.harmonic-systems.org/kinderhook.json#${b.slug}`,
      "name": b.name,
      "containedInPlace": { "@id": VILLAGE_ID },
      ...(b.url ? { "url": b.url } : {}),
      ...(b.address ? {
        "address": {
          "@type": "PostalAddress",
          "streetAddress": b.address,
          "addressLocality": "Kinderhook",
          "addressRegion": "NY",
          "postalCode": "12106",
          "addressCountry": "US",
        },
      } : {}),
      "openingHoursSpecification": (b.hours || []).map(h => ({
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": dayMap[h.day] || h.day,
        "opens":  h.opens,
        "closes": h.closes,
      })),
      ...(b.seasonal ? {
        "kh:seasonality": b.seasonal,
      } : {}),
    };
    graph.push(node);
  }

  // 6.6. Assessment + market metadata as a single Dataset node describing
  //      the village's tax-roll and market-ratio facts. Not a schema.org
  //      Place — a Dataset whose subjectOf is the village.
  if (orptsParcels || marketEquity) {
    graph.push({
      "@type": "Dataset",
      "@id": "https://fieldreports.harmonic-systems.org/kinderhook.json#assessments",
      "name": "Kinderhook assessment + market summary",
      "description": "Aggregated assessed value, full market value, residential assessment ratio, and state-published market-equity statistics for the Town of Kinderhook (which contains the village).",
      "isBasedOn": [
        "https://data.ny.gov/dataset/Property-Assessment-Data-from-Local-Assessment-Rol/7vem-aaz7",
        "https://data.ny.gov/dataset/Residential-Assessment-Ratios/bsmp-6um6",
        "https://data.ny.gov/dataset/Real-Property-Assessment-Equity-Statistics-By-Muni/4sut-q3dt",
      ],
      "spatialCoverage": { "@id": VILLAGE_ID },
      ...(orptsParcels ? {
        "kh:rollYear": orptsParcels.rollYear,
        "kh:parcelsTotal": orptsParcels.counts.total,
        "kh:parcelsVillage": orptsParcels.counts.village,
        "kh:parcelsTownOutside": orptsParcels.counts.townOutsideVillage,
        "kh:assessedTotalUSD": orptsParcels.summary.assessedTotalUSD,
        "kh:fullMarketTotalUSD": orptsParcels.summary.fullMarketTotalUSD,
      } : {}),
      ...(orptsRar ? {
        "kh:residentialAssessmentRatio": {
          "village104401": orptsRar.latest['104401'],
          "townOutside104489": orptsRar.latest['104489'],
        },
      } : {}),
      ...(marketEquity ? {
        "kh:marketValueRatioLatest": marketEquity.latest,
      } : {}),
    });
  }

  // 6.7. ACS demographics as a Dataset describing the population of the
  //      village place and the surrounding town MCD.
  if (acsVillage || acsTown) {
    graph.push({
      "@type": "Dataset",
      "@id": "https://fieldreports.harmonic-systems.org/kinderhook.json#demographics",
      "name": "Kinderhook demographics (ACS 5-Year)",
      "description": "Census Bureau American Community Survey 5-Year estimates for two geographies: the incorporated Village of Kinderhook and the surrounding Town of Kinderhook MCD.",
      "isBasedOn": `https://api.census.gov/data/${acsVillage?.vintage || acsTown?.vintage}/acs/acs5`,
      "spatialCoverage": { "@id": VILLAGE_ID },
      "kh:vintage": acsVillage?.vintage || acsTown?.vintage,
      ...(acsVillage ? { "kh:village": acsVillage.estimates } : {}),
      ...(acsTown    ? { "kh:town":    acsTown.estimates    } : {}),
    });
  }

  // 6.8. FEMA disaster history as a list of Event entities (one per
  //      declaration), each with @id at the federal declaration record.
  if (fema?.declarations) {
    for (const d of fema.declarations) {
      graph.push({
        "@type": "Event",
        "@id": `https://www.fema.gov/disaster/${d.disasterNumber}`,
        "name": d.declarationTitle || `${d.incidentType} (${d.declarationType}-${d.disasterNumber})`,
        "eventStatus": "https://schema.org/EventCompleted",
        ...(d.incidentBeginDate ? { "startDate": d.incidentBeginDate.slice(0, 10) } : {}),
        ...(d.incidentEndDate   ? { "endDate":   d.incidentEndDate.slice(0, 10)   } : {}),
        "location": {
          "@type": "AdministrativeArea",
          "name": "Columbia County, New York",
          "sameAs": "https://www.wikidata.org/wiki/Q245071",
        },
        "kh:incidentType":   d.incidentType,
        "kh:declarationType": d.declarationType,
        "kh:disasterNumber":  d.disasterNumber,
      });
    }
  }

  // 7. Top 5 historic people.
  for (const p of (histPeople?.people || []).slice(0, 5)) {
    graph.push({
      "@type": "Person",
      "@id": p.wikipedia || `https://www.wikidata.org/wiki/${p.qid}`,
      "name": p.name,
      ...(p.description ? { "description": p.description } : {}),
      ...(p.birth ? { "birthDate": p.birth.slice(0, 10) } : {}),
      ...(p.death ? { "deathDate": p.death.slice(0, 10) } : {}),
      "birthPlace": { "@id": VILLAGE_ID },
      "sameAs": [p.wikipedia, `https://www.wikidata.org/wiki/${p.qid}`].filter(Boolean),
    });
  }

  const document = {
    "@context": [
      "https://schema.org",
      { "kh": "https://fieldreports.harmonic-systems.org/ns/kh#" },
    ],
    "@graph": graph,
  };

  // Carry the build metadata as a separate top-level property (outside @graph
  // so it doesn't get treated as a schema.org entity).
  const wrapped = {
    ...document,
    "_meta": {
      builder: "tools/build-jsonld.mjs",
      builtAt: new Date().toISOString(),
      sources: {
        events: events?.fetchedAt || null,
        venues: venues?.fetchedAt || null,
        osm: osmSnap?.fetchedAt || null,
        historicSites: histSites?.fetchedAt || null,
        historicPeople: histPeople?.fetchedAt || null,
        orptsParcels: orptsParcels?.fetchedAt || null,
        orptsRar: orptsRar?.fetchedAt || null,
        marketEquity: marketEquity?.fetchedAt || null,
        acsVillage: acsVillage?.fetchedAt || null,
        acsTown: acsTown?.fetchedAt || null,
        fema: fema?.fetchedAt || null,
      },
      counts: {
        graph: graph.length,
        curatedPlaces: curatedPlaces.filter(Boolean).length,
        coverageArticles: coverageEntries.filter(c => c && c.type === 'article').length,
        historicSites: Math.min(15, (histSites?.sites || []).length),
        historicPeople: Math.min(5, (histPeople?.people || []).length),
        localBusinesses: verifiedBusinesses.length,
        localBusinessesProvisional: (hoursManifest.businesses || []).length - verifiedBusinesses.length,
        femaDisasters: fema?.declarations?.length || 0,
      },
    },
  };

  await writeFile(OUT, JSON.stringify(wrapped, null, 2) + '\n');
  console.log(`[build-jsonld] wrote ${OUT}  (${graph.length} entities)`);
}

main().catch(err => { console.error(err); process.exit(1); });
