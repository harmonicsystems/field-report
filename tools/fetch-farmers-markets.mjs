#!/usr/bin/env node
/*
 * fetch-farmers-markets.mjs
 *
 * Snapshots the NYS Department of Agriculture and Markets' authoritative
 * list of farmers' markets, from data.ny.gov (Socrata qq4h-8p86). Pulls
 * the Kinderhook market specifically and Columbia County peers for
 * context. The state record is the ground truth this report cross-checks
 * the curated `schema/places/kinderhook-farmers-market.json` against.
 *
 * Source: https://data.ny.gov/resource/qq4h-8p86.json
 * Output: data/snapshots/farmers-markets/{date,latest}.json
 *
 * Usage:  node tools/fetch-farmers-markets.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR = resolve(REPO_ROOT, 'data/snapshots/farmers-markets');
const SOURCE = 'https://data.ny.gov/resource/qq4h-8p86.json';
const UA = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const COUNTY = 'Columbia';
const today = new Date().toISOString().slice(0, 10);

function shape(r) {
  return {
    name: r.market_name,
    location: r.market_location,
    address: r.address_line_1,
    city: r.city,
    zip: r.zip,
    contact: r.contact,
    website: r.market_link,
    operationHours: r.operation_hours,
    operationSeason: r.operation_season,
    operationMonths: r.operation_months_code,
    fmnp: r.fmnp,                  // Farmers Market Nutrition Program participation
    snapStatus: r.snap_status,     // SNAP/EBT acceptance
    farmCount: r.fc,               // farmer count, sometimes
    county: r.county,
  };
}

async function main() {
  console.log(`[start] ${SOURCE}`);
  const r = await fetch(`${SOURCE}?$where=county='${COUNTY}'&$limit=200`, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error(`${r.status}`);
  const rows = (await r.json()).map(shape);

  const village = rows.find(m => /kinderhook/i.test(m.city || '')) || null;
  const county = rows.sort((a, b) => (a.city || '').localeCompare(b.city || ''));

  // Statewide total for context.
  const totalR = await fetch(`${SOURCE}?$select=count(*)`, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  const totalJson = await totalR.json();
  const statewideTotal = +totalJson[0]?.count || null;

  const snap = {
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-farmers-markets.mjs',
    source: SOURCE,
    program: {
      name: 'New York State Farmers\' Markets',
      agency: 'NYS Department of Agriculture and Markets',
      url: 'https://agriculture.ny.gov/farming/farmers-markets',
    },
    counts: {
      statewide: statewideTotal,
      county: county.length,
    },
    village,
    county,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const payload = JSON.stringify(snap, null, 2) + '\n';
  await writeFile(resolve(OUT_DIR, `${today}.json`), payload);
  await writeFile(resolve(OUT_DIR, 'latest.json'), payload);
  console.log(`[done] village: ${village?.name || '—'}; county peers: ${county.length}; statewide: ${statewideTotal}`);
}

main().catch(err => { console.error(err); process.exit(1); });
