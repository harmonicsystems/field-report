#!/usr/bin/env node
/*
 * fetch-historical.mjs
 *
 * One build-time pass over the historical sources for Kinderhook:
 *
 *   1. Wikidata (SPARQL)          — historic sites in the village bbox
 *                                    with NRHP ref, inception date, coords
 *   2. Wikidata (SPARQL)          — notable people born/died in Kinderhook
 *                                    plus Martin Van Buren (Q11820) directly
 *   3. Wikipedia (REST summaries) — paragraphs for key articles
 *   4. Library of Congress        — Chronicling America newspaper mentions
 *
 * Writes organized snapshots under data/snapshots/ per source. The page
 * reads these; no live fetches at page-view time. All queries are
 * rate-limited where needed and identify themselves with a User-Agent.
 *
 * Usage: node tools/fetch-historical.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const UA = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const today = new Date().toISOString().slice(0, 10);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function writeSnap(relDir, name, data) {
  const out = resolve(REPO_ROOT, 'data/snapshots', relDir, `${today}-${name}.json`);
  const latest = resolve(REPO_ROOT, 'data/snapshots', relDir, `latest-${name}.json`);
  await mkdir(dirname(out), { recursive: true });
  const payload = JSON.stringify(data, null, 2) + '\n';
  await writeFile(out, payload);
  await writeFile(latest, payload);
  console.log(`[write] ${relDir}/${name}`);
}

/* ---------- Wikidata SPARQL ---------- */

async function wdqs(query) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
  const r = await fetch(url, { headers: { 'Accept': 'application/sparql-results+json', 'User-Agent': UA } });
  if (!r.ok) throw new Error(`WDQS ${r.status}`);
  const d = await r.json();
  return d.results.bindings;
}

async function fetchHistoricSites() {
  // Historic built things in the Kinderhook village bbox.
  // Kinderhook village ~42.40°N, -73.69°W; bbox widened south to include
  // Lindenwald (Martin Van Buren NHS).
  const q = `SELECT DISTINCT ?item ?itemLabel ?itemDescription ?coord ?inception ?nrhp ?article ?instanceLabel WHERE {
    SERVICE wikibase:box {
      ?item wdt:P625 ?coord .
      bd:serviceParam wikibase:cornerSouthWest "Point(-73.75 42.35)"^^geo:wktLiteral .
      bd:serviceParam wikibase:cornerNorthEast "Point(-73.62 42.43)"^^geo:wktLiteral .
    }
    { ?item wdt:P1435 [] } UNION { ?item wdt:P649 ?nrhp } UNION { ?item wdt:P31/wdt:P279* wd:Q839954 } UNION { ?item wdt:P31/wdt:P279* wd:Q16970 } UNION { ?item wdt:P31/wdt:P279* wd:Q39614 } UNION { ?item wdt:P31/wdt:P279* wd:Q5003624 }
    OPTIONAL { ?item wdt:P571 ?inception }
    OPTIONAL { ?item wdt:P649 ?nrhp }
    OPTIONAL { ?item wdt:P31 ?instance }
    OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
  } LIMIT 60`;

  const rows = await wdqs(q);
  const seen = new Map();
  for (const b of rows) {
    const qid = b.item.value.split('/').pop();
    const existing = seen.get(qid);
    const rec = existing || {
      qid,
      name: b.itemLabel?.value,
      description: b.itemDescription?.value,
      instance: b.instanceLabel?.value,
      coord: b.coord?.value,
      inception: b.inception?.value || null,
      nrhp: b.nrhp?.value || null,
      wikipedia: b.article?.value || null,
    };
    // Prefer rows that have inception / nrhp if duplicates arrive.
    if (!rec.inception && b.inception?.value) rec.inception = b.inception.value;
    if (!rec.nrhp && b.nrhp?.value) rec.nrhp = b.nrhp.value;
    seen.set(qid, rec);
  }
  return [...seen.values()];
}

async function fetchHistoricPeople() {
  // Notable people born or died in Kinderhook (village or town).
  const q = `SELECT DISTINCT ?item ?itemLabel ?itemDescription ?birth ?death ?article ?sitelinks WHERE {
    { ?item wdt:P19 wd:Q3478629 } UNION { ?item wdt:P19 wd:Q3710663 }
    UNION { ?item wdt:P20 wd:Q3478629 } UNION { ?item wdt:P20 wd:Q3710663 }
    OPTIONAL { ?item wdt:P569 ?birth }
    OPTIONAL { ?item wdt:P570 ?death }
    OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
    OPTIONAL { ?item wikibase:sitelinks ?sitelinks }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
  } ORDER BY DESC(?sitelinks) LIMIT 40`;

  const rows = await wdqs(q);
  const people = rows.map(b => ({
    qid: b.item.value.split('/').pop(),
    name: b.itemLabel?.value,
    description: b.itemDescription?.value,
    birth: b.birth?.value || null,
    death: b.death?.value || null,
    wikipedia: b.article?.value || null,
    sitelinks: b.sitelinks ? +b.sitelinks.value : null,
  }));

  // Include Van Buren explicitly even if his P19/P20 don't match (he was
  // born in Kinderhook town and died here, Wikidata typically carries that).
  if (!people.find(p => p.qid === 'Q11820')) {
    console.log('[people] Van Buren missing from spatial query; fetching directly');
    const direct = await wdqs(`SELECT ?itemLabel ?itemDescription ?birth ?death ?article WHERE {
      BIND(wd:Q11820 AS ?item)
      OPTIONAL { ?item wdt:P569 ?birth }
      OPTIONAL { ?item wdt:P570 ?death }
      OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }`);
    if (direct[0]) {
      const b = direct[0];
      people.unshift({
        qid: 'Q11820',
        name: b.itemLabel?.value,
        description: b.itemDescription?.value,
        birth: b.birth?.value,
        death: b.death?.value,
        wikipedia: b.article?.value,
        sitelinks: null,
      });
    }
  }

  return people;
}

/* ---------- Wikipedia summaries ---------- */

const KEY_ARTICLES = [
  'Kinderhook_(village),_New_York',
  'Kinderhook_(town),_New_York',
  'Martin_Van_Buren',
  'Lindenwald',
  'Luykas_Van_Alen_House',
  'Ichabod_Crane',
  'James_Vanderpoel_House',
  'Kinderhook_Village_District',
];

async function fetchWikipediaSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return { title, error: `${r.status}` };
  const d = await r.json();
  return {
    title: d.titles?.canonical || title,
    displayTitle: d.title || d.displaytitle || title,
    description: d.description || null,
    extract: d.extract || null,
    wikibaseItem: d.wikibase_item || null,
    coordinates: d.coordinates || null,
    url: d.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${title}`,
    thumbnail: d.thumbnail?.source || null,
  };
}

async function fetchWikipediaSummaries() {
  const out = [];
  for (const t of KEY_ARTICLES) {
    try {
      out.push(await fetchWikipediaSummary(t));
    } catch (e) {
      out.push({ title: t, error: e.message });
    }
    await sleep(300);
  }
  return out;
}

/* ---------- Library of Congress Chronicling America ---------- */

async function fetchChroniclingAmerica() {
  // LoC search API for historic newspaper pages mentioning Kinderhook.
  // The old chroniclingamerica.loc.gov endpoint now redirects to the
  // unified www.loc.gov/collections/chronicling-america search.
  const url = 'https://www.loc.gov/collections/chronicling-america/?q=Kinderhook&fo=json&c=50';
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`LoC ${r.status}`);
  const d = await r.json();
  const total = d.pagination?.of ?? 0;
  const results = d.results || [];

  // Slim each result down to the fields worth publishing.
  const items = results.slice(0, 50).map(item => ({
    date: item.date || null,
    title: item.title || null,
    url: item.id || item.url || null,
    place: Array.isArray(item.location) ? item.location[0] : (item.location || null),
    description: typeof item.description === 'string'
      ? item.description.slice(0, 280)
      : (Array.isArray(item.description) ? item.description[0]?.slice(0, 280) : null),
  })).filter(i => i.url);

  // Count by decade so we can render a distribution.
  const byDecade = {};
  for (const it of items) {
    const y = it.date?.slice(0, 4);
    if (!y) continue;
    const dec = y.slice(0, 3) + '0s';
    byDecade[dec] = (byDecade[dec] || 0) + 1;
  }

  return { total, sampled: items.length, byDecade, items };
}

/* ---------- driver ---------- */

async function main() {
  console.log(`[start] ${today}`);

  console.log('[wikidata] historic sites…');
  const sites = await fetchHistoricSites();
  console.log(`  ${sites.length} sites`);

  console.log('[wikidata] historic people…');
  const people = await fetchHistoricPeople();
  console.log(`  ${people.length} people (top: ${people.slice(0,3).map(p=>p.name).join(', ')})`);

  console.log('[wikipedia] summaries…');
  const summaries = await fetchWikipediaSummaries();
  console.log(`  ${summaries.filter(s => !s.error).length}/${summaries.length} ok`);

  console.log('[loc] chronicling america…');
  const newspapers = await fetchChroniclingAmerica();
  console.log(`  ${newspapers.total} total, sampled ${newspapers.sampled}`);

  const meta = { fetchedAt: new Date().toISOString(), fetcher: 'tools/fetch-historical.mjs' };

  await writeSnap('wikidata', 'kinderhook-historic-sites', { ...meta, source: 'query.wikidata.org/sparql', bbox: 'SW(-73.75, 42.35) → NE(-73.62, 42.43)', count: sites.length, sites });
  await writeSnap('wikidata', 'kinderhook-historic-people', { ...meta, source: 'query.wikidata.org/sparql', count: people.length, people });
  await writeSnap('wikipedia', 'kinderhook-summaries', { ...meta, source: 'en.wikipedia.org/api/rest_v1/page/summary/', articles: KEY_ARTICLES, summaries });
  await writeSnap('loc', 'kinderhook-chronicling-america', { ...meta, source: 'www.loc.gov/collections/chronicling-america/', ...newspapers });

  console.log('[done]');
}

main().catch(err => { console.error(err); process.exit(1); });
