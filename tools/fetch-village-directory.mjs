#!/usr/bin/env node
/*
 * fetch-village-directory.mjs
 *
 * Fetches the Village of Kinderhook business directory and structures it
 * into JSON. Writes a dated snapshot under data/snapshots/villageofkinderhook/
 * so every pull is diffable over time.
 *
 * Per CLAUDE.md: public municipal pages may be parsed at build-time, with
 * every field source-attributed. This is a stopgap until the village
 * publishes a machine-readable feed itself.
 *
 * Usage: node tools/fetch-village-directory.mjs
 *
 * Requires Node 18+ (built-in fetch). No external deps.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SOURCE_URL = 'https://www.villageofkinderhook.org/community/business_directory.php';
const UA = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';

const today = new Date().toISOString().slice(0, 10);
const OUT = resolve(REPO_ROOT, 'data/snapshots/villageofkinderhook', `${today}-businesses.json`);
const LATEST = resolve(REPO_ROOT, 'data/snapshots/villageofkinderhook/latest-businesses.json');

const decodeEntities = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&nbsp;/g, ' ');

const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();

async function main() {
  console.log(`[fetch] ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const html = await res.text();
  console.log(`[fetch] ${html.length} bytes`);

  /* Each business is scoped by a RZ.recordid marker. We split on those
     markers and parse each chunk for name, category, description, detail
     URL. The revize CMS's markup is stable enough that these selectors
     have held across versions. */
  const chunks = [...html.matchAll(/RZ\.recordid\s*=\s*'(\d+)';([\s\S]*?)(?=RZ\.recordid\s*=\s*'\d+';|<\/main>|<footer)/g)];

  const businesses = chunks.map(([, id, chunk]) => {
    const name = clean(chunk.match(/<h2[^>]*>([^<]+)<\/h2>/)?.[1]);
    const category = clean(chunk.match(/<ul class="category-list">\s*<li[^>]*>([^<]+)<\/li>/)?.[1]);
    const descRaw = clean(chunk.match(/<span class="rz-business-desc"[^>]*>([^<]*)<\/span>/)?.[1]);
    // "Find out more using the helpful links below." is the CMS boilerplate default.
    const description = descRaw && !/^find out more/i.test(descRaw) ? descRaw : null;
    const detailPath = chunk.match(/href="(business_detail_T\d+_R\d+\.php)"/)?.[1] || null;
    const phone = clean(chunk.match(/href="tel:([^"]+)"/)?.[1]) || null;
    const externalSite = chunk.match(/href="(https?:\/\/(?!www\.villageofkinderhook\.org)[^"]+)"/)?.[1] || null;
    const thumb = chunk.match(/background:\s*url\('([^']+)'\)/)?.[1] || null;

    return {
      id,
      name,
      category,
      description,
      detailUrl: detailPath ? `https://www.villageofkinderhook.org/community/${detailPath}` : null,
      phone,
      website: externalSite,
      thumbnail: thumb ? `https://www.villageofkinderhook.org/community/${thumb}` : null,
    };
  }).filter(b => b.name);

  // Sort by category then name for diffable output.
  businesses.sort((a, b) =>
    (a.category || '').localeCompare(b.category || '')
    || a.name.localeCompare(b.name));

  // Category index.
  const categories = {};
  for (const b of businesses) {
    if (!b.category) continue;
    categories[b.category] = (categories[b.category] || 0) + 1;
  }

  const snapshot = {
    source: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-village-directory.mjs',
    attribution: 'Village of Kinderhook, NY — municipal business directory. Cited as primary source; not mirrored.',
    count: businesses.length,
    categories,
    businesses,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + '\n');
  await writeFile(LATEST, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`[write] ${OUT}`);
  console.log(`[write] ${LATEST}`);
  console.log(`[done]  ${businesses.length} businesses across ${Object.keys(categories).length} categories`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
