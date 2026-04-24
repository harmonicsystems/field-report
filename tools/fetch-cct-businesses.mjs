#!/usr/bin/env node
/*
 * fetch-cct-businesses.mjs
 *
 * Walks the Columbia County Tourism business directory — every URL
 * in /business-sitemap.xml — and extracts name, address, phone,
 * website, and description into a single dated JSON snapshot.
 *
 * The business CPT is not exposed to REST (only the Yoast sitemap
 * lists it). Yoast emits WebPage/BreadcrumbList/Organization schema
 * but not LocalBusiness, so a field-by-field parse is the only way
 * to recover the structured data these pages already carry in their
 * bodies. Every field records its source URL.
 *
 * Rate-limited to 1 request per second (configurable below).
 * One full run is ~10 minutes for ~600 businesses.
 *
 * Usage: node tools/fetch-cct-businesses.mjs
 *        node tools/fetch-cct-businesses.mjs --limit 20     # test run
 *        node tools/fetch-cct-businesses.mjs --filter kinderhook
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const INDEX = resolve(REPO_ROOT, 'data/snapshots/columbiacountytourism/latest-business-index.json');
const UA = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const DELAY_MS = 1000;

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const filterIdx = args.indexOf('--filter');
const FILTER = filterIdx >= 0 ? args[filterIdx + 1].toLowerCase() : null;

const today = new Date().toISOString().slice(0, 10);
const OUT = resolve(REPO_ROOT, 'data/snapshots/columbiacountytourism', `${today}-businesses.json`);
const LATEST = resolve(REPO_ROOT, 'data/snapshots/columbiacountytourism/latest-businesses.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\+/g, ' ');

const clean = (s) => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function parseBusinessPage(html, url) {
  const out = { url, name: null, description: null, phone: null, website: null, address: null, thumbnail: null };

  out.name = clean(html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]);

  // Google Maps daddr URL is the cleanest structured address source.
  const mapsUrl = html.match(/https?:\/\/maps\.google\.com\/maps\?daddr=([^"'\s&]+)/)?.[1];
  if (mapsUrl) {
    const parts = decodeURIComponent(mapsUrl).split(',').map(s => decode(s).trim()).filter(Boolean);
    // parts[0] is usually the business name; remainder is the postal address.
    const addr = parts.slice(1);
    // Heuristic: last part is "ZIP" or "STATE ZIP" or similar. Infer.
    // Common pattern from observation: STREET, CITY, ZIP  (no explicit state)
    // Another pattern:               STREET, CITY, NY ZIP
    let street = null, city = null, region = 'NY', postalCode = null;
    if (addr.length >= 3) {
      street = addr[0];
      city = addr[1];
      const last = addr[addr.length - 1];
      const zipMatch = last.match(/(\d{5}(?:-\d{4})?)/);
      const stateMatch = last.match(/\b(NY|MA|VT|CT)\b/i);
      if (zipMatch) postalCode = zipMatch[1];
      if (stateMatch) region = stateMatch[1].toUpperCase();
    } else if (addr.length === 2) {
      street = addr[0];
      city = addr[1];
    }
    out.address = {
      streetAddress: street || null,
      addressLocality: city || null,
      addressRegion: region,
      postalCode: postalCode || null,
      addressCountry: 'US',
      rawParts: addr,
    };
  }

  out.phone = html.match(/href="tel:([^"]+)"/)?.[1]?.replace(/\s+/g, '') || null;

  // External website: first http(s) link to a non-CCT, non-social domain.
  const externals = [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/g)]
    .map(m => m[1])
    .filter(u => !/columbiacountytourism\.org|maps\.google|goo\.gl|tel:|mailto:|facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|fonts\.|gstatic|googleapis|gravatar|w\.org|gmpg/i.test(u));
  out.website = externals[0] || null;

  // Description: first reasonably long paragraph that isn't the address or newsletter CTA.
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => clean(m[1]));
  const desc = paras.find(p =>
    p.length >= 40
    && p.length <= 1200
    && !/\b(newsletter|be the first|sign up|upcoming events|subscribe)\b/i.test(p)
    && !/^\d+\s+\w+\s+(street|st|avenue|ave|road|rd|lane|ln|drive|dr|way|place|pl)/i.test(p)
    && !/^\w+,\s+NY\s+\d{5}/i.test(p)
  );
  out.description = desc || null;

  // Featured image (Yoast often sets og:image)
  out.thumbnail = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1] || null;

  return out;
}

async function main() {
  const indexJson = JSON.parse(await readFile(INDEX, 'utf-8'));
  const urls = [];
  const res = await fetch(indexJson.source, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`sitemap ${res.status}`);
  const xml = await res.text();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(m[1]);
  console.log(`[sitemap] ${urls.length} business URLs`);

  const filtered = FILTER ? urls.filter(u => u.toLowerCase().includes(FILTER)) : urls;
  const todo = filtered.slice(0, LIMIT);
  console.log(`[plan]    fetching ${todo.length} page(s) at ${DELAY_MS}ms each = ~${Math.round(todo.length * DELAY_MS / 1000)}s`);

  const businesses = [];
  const errors = [];
  let i = 0;
  for (const url of todo) {
    i++;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) { errors.push({ url, status: r.status }); continue; }
      const html = await r.text();
      const biz = parseBusinessPage(html, url);
      businesses.push(biz);
      if (i % 25 === 0 || i === todo.length) {
        console.log(`[${String(i).padStart(4)}/${todo.length}] ${biz.name || '(no name)'} — ${biz.address?.addressLocality || 'no city'}`);
      }
    } catch (err) {
      errors.push({ url, error: err.message });
    }
    if (i < todo.length) await sleep(DELAY_MS);
  }

  // Kinderhook index for the report to consume cheaply.
  const kinderhook = businesses.filter(b =>
    /kinderhook/i.test(b.address?.addressLocality || '')
    || /kinderhook/i.test(b.address?.rawParts?.join(' ') || '')
  );

  // Categorize by city for the county-wide view.
  const byCity = {};
  for (const b of businesses) {
    const c = b.address?.addressLocality || '(unknown)';
    byCity[c] = (byCity[c] || 0) + 1;
  }

  const snapshot = {
    source: 'https://columbiacountytourism.org/business-sitemap.xml + /business/{slug}/',
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-cct-businesses.mjs',
    attribution: 'Columbia County Tourism — public business directory pages. Fetched once at build time, rate-limited to 1 req/sec.',
    plannedCount: todo.length,
    succeededCount: businesses.length,
    errorCount: errors.length,
    kinderhookCount: kinderhook.length,
    byCity,
    kinderhook: kinderhook.map(b => ({ ...b })),
    businesses,
    errors,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + '\n');
  await writeFile(LATEST, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`[write] ${OUT}`);
  console.log(`[done]  ${businesses.length} businesses, ${kinderhook.length} in Kinderhook, ${errors.length} errors`);
  if (errors.length) console.log('[errors]', errors.slice(0, 5));
}

main().catch(err => { console.error(err); process.exit(1); });
