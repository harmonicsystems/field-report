#!/usr/bin/env node
/*
 * fetch-ny-sales.mjs
 *
 * Snapshots the state's published, sales-derived market indicators for the
 * Town of Kinderhook (which contains the village). NY ORPTS computes these
 * annually from the actual residential sales file but only publishes the
 * machine-readable aggregates — the parcel-level sales records remain in
 * county-level PDFs. So this is what's *legible* about the local market.
 *
 *   Real Property Assessment Equity Statistics By Municipality
 *   (Socrata resource 4sut-q3dt)
 *
 * Fields of interest:
 *   - residential_market_value_ratio     assessment ÷ market, %
 *   - residential_coefficient_of_dispersion (assessment equity)
 *   - residential_price_related_differential (regressivity check)
 *   - equalization_rate                   ratio used for tax apportionment
 *
 * The municipality-level SWIS for the town as a whole is 104400.
 *
 * Source:  https://data.ny.gov  (Socrata public, no key required)
 * Output:  data/snapshots/nysales/{date,latest}-equity.json
 *
 * Usage:   node tools/fetch-ny-sales.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR   = resolve(REPO_ROOT, 'data/snapshots/nysales');
const UA        = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const today     = new Date().toISOString().slice(0, 10);

// SWIS 104400 = Town of Kinderhook (the equity stats publish at town level,
// not at village/town-outside-village split).
const TOWN_SWIS = '104400';

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function writeSnap(name, data) {
  await mkdir(OUT_DIR, { recursive: true });
  const payload = JSON.stringify(data, null, 2) + '\n';
  await writeFile(resolve(OUT_DIR, `${today}-${name}.json`),  payload);
  await writeFile(resolve(OUT_DIR, `latest-${name}.json`),    payload);
}

const numOrNull = (v) => (v == null || v === '' ? null : Number(v));

async function main() {
  console.log('[start] NY market-equity snapshot');

  const base = 'https://data.ny.gov/resource/4sut-q3dt.json';
  const where = `swis_code='${TOWN_SWIS}'`;
  const url = `${base}?$where=${encodeURIComponent(where)}&$limit=200&$order=survey_year DESC`;
  const rows = await getJson(url);
  console.log(`  ${rows.length} years of equity stats for ${TOWN_SWIS} (${rows[0]?.survey_year} → ${rows[rows.length-1]?.survey_year})`);

  const series = rows.map(r => ({
    year:                          Number(r.survey_year),
    method_residential:            r.method_of_evaluating_equity_for_residential_property || null,
    residential_market_value_ratio: numOrNull(r.residential_market_value_ratio),
    residential_cod:               numOrNull(r.residential_coefficient_of_dispersion),
    residential_prd:               numOrNull(r.residential_price_related_differential),
    all_property_cod:              numOrNull(r.all_property_coefficient_of_dispersion),
    equalization_rate:             numOrNull(r.equalization_rate),
    population_per_sq_mi:          numOrNull(r.population_per_square_mile),
  })).sort((a, b) => a.year - b.year);

  await writeSnap('equity', {
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-ny-sales.mjs',
    source: `${base}?$where=${where}`,
    swis: TOWN_SWIS,
    municipality: 'Town of Kinderhook',
    datasetTitle: 'Real Property Assessment Equity Statistics By Municipality',
    datasetId: '4sut-q3dt',
    note: 'These are the only sales-derived market figures the state publishes machine-readably for this jurisdiction. Parcel-level sales records exist but are released only as county-level PDFs.',
    series,
    latest: series[series.length - 1] || null,
  });

  console.log('[done] NY market-equity snapshot');
}

main().catch(err => { console.error(err); process.exit(1); });
