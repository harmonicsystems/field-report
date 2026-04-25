#!/usr/bin/env node
/*
 * fetch-crossrefs.mjs
 *
 * Snapshots the two community-knowledge sources the §VIII Cross-references
 * section reads at render time:
 *
 *   1. Wikidata (SPARQL) — entities whose P131 (located-in) points at the
 *      Kinderhook village (Q3478629) or the surrounding town (Q3710663).
 *   2. OpenStreetMap (Overpass) — named features in a bbox around the
 *      village, widened south to include Lindenwald (Martin Van Buren NHS).
 *
 * Both are public community APIs. Pulling them at build-time rather than
 * on every page view is the polite move.
 *
 * Usage: node tools/fetch-crossrefs.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const UA = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const TOWN = 'kinderhook';
const PLACE = {
  wikidata: ['Q3478629', 'Q3710663'],            // village, town
  bbox: [42.35, -73.72, 42.42, -73.65],          // S, W, N, E — includes Lindenwald
  wikipedia: 'Kinderhook_(village),_New_York',
  officialSite: 'https://www.villageofkinderhook.org/',
};

const today = new Date().toISOString().slice(0, 10);

async function writeSnap(dir, name, data) {
  const out = resolve(REPO_ROOT, 'data/snapshots', dir);
  await mkdir(out, { recursive: true });
  const payload = JSON.stringify(data, null, 2) + '\n';
  await writeFile(resolve(out, `${today}-${name}.json`), payload);
  await writeFile(resolve(out, `latest-${name}.json`), payload);
}

const meta = () => ({ fetchedAt: new Date().toISOString(), fetcher: 'tools/fetch-crossrefs.mjs' });

/* ---------- Wikidata ---------- */
async function fetchWikidata() {
  const values = PLACE.wikidata.map(q => `wd:${q}`).join(' ');
  const sparql = `SELECT DISTINCT ?item ?itemLabel ?instanceLabel ?article WHERE {
    VALUES ?place { ${values} }
    ?item wdt:P131 ?place .
    ?item wdt:P31 ?instance .
    OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
  } LIMIT 60`;

  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql);
  const r = await fetch(url, { headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': UA } });
  if (!r.ok) throw new Error(`WDQS ${r.status}`);
  const data = await r.json();

  const seen = new Map();
  for (const b of data.results.bindings) {
    const qid = b.item.value.split('/').pop();
    if (!seen.has(qid)) {
      seen.set(qid, {
        qid,
        name: b.itemLabel?.value || qid,
        instance: b.instanceLabel?.value || '',
        article: b.article?.value || null,
      });
    }
  }
  return [...seen.values()];
}

/* ---------- OpenStreetMap Overpass ---------- */
async function fetchOSM() {
  const [s, w, n, e] = PLACE.bbox;
  const q = `[out:json][timeout:30];
    (
      node["name"]["historic"](${s},${w},${n},${e});
      node["name"]["tourism"](${s},${w},${n},${e});
      node["name"]["amenity"~"restaurant|cafe|bar|pub|library|place_of_worship|school|theatre|townhall|community_centre|arts_centre|fire_station|post_office"](${s},${w},${n},${e});
      node["name"]["shop"](${s},${w},${n},${e});
      node["name"]["memorial"](${s},${w},${n},${e});
      way["name"]["historic"](${s},${w},${n},${e});
      way["name"]["tourism"](${s},${w},${n},${e});
    );
    out center tags 200;`;
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Overpass ${r.status}`);
  const data = await r.json();
  return (data.elements || []).filter(el => el.tags?.name).map(el => ({
    id: el.id,
    type: el.type,
    name: el.tags.name,
    tags: el.tags,
    lat: el.lat ?? el.center?.lat,
    lon: el.lon ?? el.center?.lon,
  }));
}

async function main() {
  console.log('[wikidata] entities P131 = Kinderhook village/town');
  const wd = await fetchWikidata();
  console.log(`  ${wd.length} entities`);
  await writeSnap('wikidata', 'kinderhook-crossrefs', { ...meta(), source: 'query.wikidata.org/sparql', config: PLACE, count: wd.length, entities: wd });

  console.log('[osm] named features in bbox');
  const osm = await fetchOSM();
  console.log(`  ${osm.length} features`);
  await writeSnap('openstreetmap', 'kinderhook-features', { ...meta(), source: 'overpass-api.de/api/interpreter', config: PLACE, count: osm.length, features: osm });

  console.log('[done]');
}

main().catch(err => { console.error(err); process.exit(1); });
