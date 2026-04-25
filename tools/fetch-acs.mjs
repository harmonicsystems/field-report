#!/usr/bin/env node
/*
 * fetch-acs.mjs
 *
 * Snapshots the Census Bureau's American Community Survey 5-Year estimates
 * for the two geographies that describe Kinderhook:
 *
 *   - Place 36-39562       — Kinderhook village, NY (incorporated village)
 *   - County subdivision   — Kinderhook town, Columbia County, NY
 *     (state 36, county 021, MCD 39573)
 *
 * Source:  https://api.census.gov/data/{vintage}/acs/acs5
 *          (no API key required for moderate request rates)
 *
 * Variables captured cover the categories most useful for civic legibility:
 *   population, age, household composition, housing tenure, year built,
 *   median rent / value, income, commute, race/ethnicity, language at home.
 *
 * Output:  data/snapshots/acs/{date,latest}-{geo}.json
 *
 * Usage:   node tools/fetch-acs.mjs [--year=2022]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR   = resolve(REPO_ROOT, 'data/snapshots/acs');
const UA        = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const today     = new Date().toISOString().slice(0, 10);

const yearArg = process.argv.find(a => a.startsWith('--year='));
const VINTAGE = yearArg ? yearArg.split('=')[1] : '2022';

const VARS = {
  // Population + age
  B01001_001E: 'population_total',
  B01002_001E: 'median_age',

  // Households
  B11001_001E: 'households_total',
  B11001_002E: 'households_family',
  B11001_007E: 'households_nonfamily',
  B25010_001E: 'avg_household_size',

  // Housing tenure + vacancy
  B25001_001E: 'housing_units_total',
  B25002_002E: 'housing_units_occupied',
  B25002_003E: 'housing_units_vacant',
  B25003_002E: 'tenure_owner_occupied',
  B25003_003E: 'tenure_renter_occupied',

  // Year structure built (selected buckets)
  B25034_001E: 'yrbuilt_total',
  B25034_010E: 'yrbuilt_1939_or_earlier',
  B25034_009E: 'yrbuilt_1940_1949',
  B25034_002E: 'yrbuilt_2014_or_later',

  // Median rent + value
  B25064_001E: 'median_gross_rent',
  B25077_001E: 'median_value_owner_occupied',

  // Income
  B19013_001E: 'median_household_income',
  B19301_001E: 'per_capita_income',
  B17001_001E: 'poverty_universe',
  B17001_002E: 'income_below_poverty_level',

  // Race / ethnicity
  B02001_002E: 'race_white_alone',
  B02001_003E: 'race_black_alone',
  B02001_005E: 'race_asian_alone',
  B03003_003E: 'hispanic_or_latino',

  // Language
  B16001_001E: 'language_population_5_plus',
  B16001_002E: 'language_english_only',

  // Commute
  B08303_001E: 'commute_total_workers',
  B08303_013E: 'commute_60_plus_min',
};

const VAR_LIST = Object.keys(VARS).join(',');

async function getCensus(geo) {
  const url = `https://api.census.gov/data/${VINTAGE}/acs/acs5?get=NAME,${VAR_LIST}&${geo}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const json = await r.json();
  // Census returns [headers, ...rows]. Each row: [name, ...values, geo cols].
  const [headers, ...rows] = json;
  return rows.map(row => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i]; });
    return o;
  });
}

async function writeSnap(name, data) {
  await mkdir(OUT_DIR, { recursive: true });
  const payload = JSON.stringify(data, null, 2) + '\n';
  await writeFile(resolve(OUT_DIR, `${today}-${name}.json`),  payload);
  await writeFile(resolve(OUT_DIR, `latest-${name}.json`),    payload);
}

function shape(rawRow, label, geoSpec) {
  const out = { _name: rawRow.NAME, _label: label, _geoSpec: geoSpec };
  for (const [code, field] of Object.entries(VARS)) {
    const raw = rawRow[code];
    const n = raw == null || raw === '' ? null : Number(raw);
    out[field] = Number.isFinite(n) && n !== -666666666 ? n : null;
  }
  return out;
}

async function main() {
  console.log(`[start] ACS 5-Year ${VINTAGE} snapshot`);

  // Village place
  console.log('[village place 39562]');
  const villageRows = await getCensus('for=place:39562&in=state:36');
  const village = shape(villageRows[0], 'Kinderhook village, NY', 'place:39562 in state:36');

  // Town MCD
  console.log('[town MCD 39573]');
  const townRows = await getCensus('for=county%20subdivision:39573&in=state:36+county:021');
  const town = shape(townRows[0], 'Kinderhook town, Columbia County, NY', 'cousub:39573 in state:36 county:021');

  await writeSnap('village', {
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-acs.mjs',
    vintage: VINTAGE,
    source: `https://api.census.gov/data/${VINTAGE}/acs/acs5`,
    variables: VARS,
    geography: { type: 'place', state: '36', place: '39562', name: 'Kinderhook village, NY' },
    estimates: village,
  });

  await writeSnap('town', {
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-acs.mjs',
    vintage: VINTAGE,
    source: `https://api.census.gov/data/${VINTAGE}/acs/acs5`,
    variables: VARS,
    geography: { type: 'county_subdivision', state: '36', county: '021', cousub: '39573', name: 'Kinderhook town, Columbia County, NY' },
    estimates: town,
  });

  console.log(`[done] village pop=${village.population_total}, town pop=${town.population_total}`);
}

main().catch(err => { console.error(err); process.exit(1); });
