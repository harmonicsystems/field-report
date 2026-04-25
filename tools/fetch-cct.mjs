#!/usr/bin/env node
/*
 * fetch-cct.mjs
 *
 * Snapshots every Columbia County Tourism data source the page reads
 * at render time, so the live page can be served from local JSON.
 * Captures the four published taxonomies, the events calendar (TEC),
 * the venues directory (TEC), Kinderhook editorial posts, and the
 * unified search index for the village.
 *
 * Output: data/snapshots/columbiacountytourism/latest-{slice}.json
 *         + dated copies for diffing.
 *
 * Two larger CCT pulls have their own tools:
 *   tools/fetch-cct-business-index.mjs   (594 sitemap URLs, 1 fetch)
 *   tools/fetch-cct-businesses.mjs       (594 detail pages, ~10 min)
 *
 * Usage: node tools/fetch-cct.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const API = 'https://columbiacountytourism.org/wp-json';
const UA = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const TOWN = 'kinderhook';

const today = new Date().toISOString().slice(0, 10);
const OUT_DIR = resolve(REPO_ROOT, 'data/snapshots/columbiacountytourism');

async function writeSnap(name, data) {
  await mkdir(OUT_DIR, { recursive: true });
  const payload = JSON.stringify(data, null, 2) + '\n';
  await writeFile(resolve(OUT_DIR, `${today}-${name}.json`), payload);
  await writeFile(resolve(OUT_DIR, `latest-${name}.json`), payload);
}

async function getJson(path) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function fetchAll(path, maxPages = 5) {
  const results = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${API}${path}${sep}per_page=100&page=${page}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!r.ok) {
      if (r.status === 400 && page > 1) break;
      throw new Error(`${r.status} ${url}`);
    }
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 100) break;
  }
  return results;
}

const meta = () => ({ fetchedAt: new Date().toISOString(), fetcher: 'tools/fetch-cct.mjs' });

async function main() {
  console.log('[start] CCT snapshot pass');

  // --- Taxonomies (the four §I cards) ---
  console.log('[ontology]');
  const [categories, tags, tribeCats, bizCats] = await Promise.all([
    fetchAll('/wp/v2/categories', 3),
    fetchAll('/wp/v2/tags', 3),
    fetchAll('/wp/v2/tribe_events_cat', 3),
    fetchAll('/wp/v2/business-category', 3),
  ]);
  console.log(`  categories=${categories.length}  tags=${tags.length}  tribe_events_cat=${tribeCats.length}  business-category=${bizCats.length}`);
  await writeSnap('ontology', { ...meta(), source: `${API}/wp/v2/{taxonomy}`, categories, tags, tribe_events_cat: tribeCats, business_category: bizCats });

  // --- Events (TEC) — current date forward ---
  console.log('[events]');
  const today10 = today;
  const eventsData = await getJson(`/tribe/events/v1/events?per_page=50&start_date=${today10}`);
  const allEvents = eventsData.events || [];
  console.log(`  ${allEvents.length} county-wide events from ${today10}`);
  await writeSnap('events', { ...meta(), source: `${API}/tribe/events/v1/events?start_date=${today10}`, count: allEvents.length, events: allEvents });

  // --- Venues (TEC, all county-wide) ---
  console.log('[venues]');
  const venuesData = await getJson('/tribe/events/v1/venues?per_page=100');
  const allVenues = venuesData.venues || [];
  console.log(`  ${allVenues.length} county-wide event venues`);
  await writeSnap('venues', { ...meta(), source: `${API}/tribe/events/v1/venues`, count: allVenues.length, venues: allVenues });

  // --- Editorial posts in the Kinderhook category ---
  console.log('[posts]');
  const khCats = categories.filter(c => c.slug.toLowerCase().includes(TOWN) || c.name.toLowerCase().includes(TOWN));
  const catIds = khCats.map(c => c.id).join(',');
  let posts = [];
  if (catIds) {
    posts = await fetchAll(`/wp/v2/posts?categories=${catIds}&_embed=1`, 2);
  }
  console.log(`  ${posts.length} posts in editorial category(ies) ${catIds || '(none matching)'}`);
  await writeSnap('posts', { ...meta(), source: `${API}/wp/v2/posts?categories=${catIds}`, town: TOWN, matchingCategoryIds: khCats.map(c => c.id), count: posts.length, posts });

  // --- Unified search (the §II Footprint source) ---
  console.log('[search]');
  const search = await getJson(`/wp/v2/search?search=${encodeURIComponent(TOWN)}&per_page=100`);
  console.log(`  ${search.length} hits for "${TOWN}"`);
  await writeSnap('search-kinderhook', { ...meta(), source: `${API}/wp/v2/search?search=${TOWN}`, town: TOWN, count: search.length, hits: search });

  console.log('[done] CCT snapshot pass');
}

main().catch(err => { console.error(err); process.exit(1); });
