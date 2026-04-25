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
      },
      counts: {
        graph: graph.length,
        curatedPlaces: curatedPlaces.filter(Boolean).length,
        coverageArticles: coverageEntries.filter(c => c && c.type === 'article').length,
        historicSites: Math.min(15, (histSites?.sites || []).length),
        historicPeople: Math.min(5, (histPeople?.people || []).length),
      },
    },
  };

  await writeFile(OUT, JSON.stringify(wrapped, null, 2) + '\n');
  console.log(`[build-jsonld] wrote ${OUT}  (${graph.length} entities)`);
}

main().catch(err => { console.error(err); process.exit(1); });
