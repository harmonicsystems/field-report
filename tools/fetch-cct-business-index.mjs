#!/usr/bin/env node
/*
 * fetch-cct-business-index.mjs
 *
 * Columbia County Tourism publishes /business/{slug}/ pages for its
 * full business directory (594+ as of this writing) but does NOT
 * expose the `business` custom post type via REST. The one public,
 * machine-readable surface for the full directory is the Yoast
 * sitemap at /business-sitemap.xml.
 *
 * This tool fetches that sitemap, counts total business URLs, and
 * extracts the slugs that identify as Kinderhook by URL alone
 * (many don't — "the-aviary", "old-dutch-inn", "isola-wine-tapas"
 * are all Kinderhook by address, invisible to slug matching).
 *
 * We do not fetch the 594 detail pages here. That's a larger posture
 * decision; see §V "No LocalBusiness JSON-LD on the county site".
 *
 * Usage: node tools/fetch-cct-business-index.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SITEMAP = 'https://columbiacountytourism.org/business-sitemap.xml';
const UA = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';

const today = new Date().toISOString().slice(0, 10);
const OUT = resolve(REPO_ROOT, 'data/snapshots/columbiacountytourism', `${today}-business-index.json`);
const LATEST = resolve(REPO_ROOT, 'data/snapshots/columbiacountytourism/latest-business-index.json');

async function main() {
  console.log(`[fetch] ${SITEMAP}`);
  const res = await fetch(SITEMAP, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const xml = await res.text();

  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const slugs = urls.map(u => u.replace(/\/$/, '').split('/').pop());
  const kinderhookSlugs = slugs.filter(s => /kinderhook/i.test(s)).sort();

  const snapshot = {
    source: SITEMAP,
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-cct-business-index.mjs',
    attribution: 'Columbia County Tourism — public Yoast sitemap. Index only; detail pages not fetched.',
    totalBusinessUrls: urls.length,
    kinderhookBySlugCount: kinderhookSlugs.length,
    kinderhookBySlug: kinderhookSlugs.map(slug => ({
      slug,
      url: `https://columbiacountytourism.org/business/${slug}/`,
    })),
    note: 'Slug-only match. Many Kinderhook businesses have slugs that do not contain the town name (the-aviary, old-dutch-inn, isola-wine-tapas). Full enumeration would require fetching each of the ' + urls.length + ' detail pages — held as an open posture decision.',
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + '\n');
  await writeFile(LATEST, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`[write] ${OUT}`);
  console.log(`[done]  ${urls.length} total business URLs, ${kinderhookSlugs.length} match "kinderhook" by slug`);
}

main().catch(err => { console.error(err); process.exit(1); });
