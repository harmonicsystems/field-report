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
 *   population (totals + under-18 + 65+), age, household composition,
 *   housing tenure, year built, median rent / value, income, commute
 *   mode + duration, race/ethnicity, language at home, educational
 *   attainment (bachelor's / graduate), broadband subscription,
 *   veteran status.
 *
 * The Census API caps variables-per-request at around 50, so this
 * script issues two requests per geography (CORE + EXT) and merges.
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

// CORE: the variables that have been in this fetcher since the start.
const VARS_CORE = {
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

  // Commute (duration)
  B08303_001E: 'commute_total_workers',
  B08303_013E: 'commute_60_plus_min',
};

// EXT: variables added 2026-04 to broaden the demographic picture —
// educational attainment, age brackets, broadband, veterans, mode of
// transport. Issued as a separate Census request because the combined
// set exceeds the API's per-request variable cap.
const VARS_EXT = {
  // Educational attainment (universe: pop 25 years and over; B15003)
  B15003_001E: 'edu_total_25_plus',
  B15003_017E: 'edu_high_school_diploma',
  B15003_018E: 'edu_ged',
  B15003_021E: 'edu_associates',
  B15003_022E: 'edu_bachelors',
  B15003_023E: 'edu_masters',
  B15003_024E: 'edu_professional',
  B15003_025E: 'edu_doctorate',

  // Age brackets — under 18 (B09001) + components of 65+ summed in shape()
  B09001_001E: 'pop_under_18',
  B01001_020E: 'pop_male_65_66',
  B01001_021E: 'pop_male_67_69',
  B01001_022E: 'pop_male_70_74',
  B01001_023E: 'pop_male_75_79',
  B01001_024E: 'pop_male_80_84',
  B01001_025E: 'pop_male_85_plus',
  B01001_044E: 'pop_female_65_66',
  B01001_045E: 'pop_female_67_69',
  B01001_046E: 'pop_female_70_74',
  B01001_047E: 'pop_female_75_79',
  B01001_048E: 'pop_female_80_84',
  B01001_049E: 'pop_female_85_plus',

  // Internet subscription (B28002)
  B28002_001E: 'internet_universe',
  B28002_004E: 'internet_with_broadband',
  B28002_013E: 'internet_no_subscription',

  // Veteran status (B21001, civilian pop 18+)
  B21001_001E: 'veteran_universe',
  B21001_002E: 'veterans',

  // Means of transportation to work (B08301)
  B08301_001E: 'commute_mode_total',
  B08301_003E: 'commute_drove_alone',
  B08301_004E: 'commute_carpool',
  B08301_010E: 'commute_public_transit',
  B08301_018E: 'commute_bicycle',
  B08301_019E: 'commute_walked',
  B08301_021E: 'commute_worked_from_home',
};

const ALL_VARS = { ...VARS_CORE, ...VARS_EXT };

async function getCensus(geo, vars) {
  const list = Object.keys(vars).join(',');
  const url = `https://api.census.gov/data/${VINTAGE}/acs/acs5?get=NAME,${list}&${geo}`;
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

async function getCensusFull(geo) {
  // Two requests, merged. Keeps us under the per-request variable cap.
  const [coreRow] = await getCensus(geo, VARS_CORE);
  const [extRow]  = await getCensus(geo, VARS_EXT);
  return { ...coreRow, ...extRow };
}

async function writeSnap(name, data) {
  await mkdir(OUT_DIR, { recursive: true });
  const payload = JSON.stringify(data, null, 2) + '\n';
  await writeFile(resolve(OUT_DIR, `${today}-${name}.json`),  payload);
  await writeFile(resolve(OUT_DIR, `latest-${name}.json`),    payload);
}

function shape(rawRow, label, geoSpec) {
  const out = { _name: rawRow.NAME, _label: label, _geoSpec: geoSpec };
  for (const [code, field] of Object.entries(ALL_VARS)) {
    const raw = rawRow[code];
    const n = raw == null || raw === '' ? null : Number(raw);
    out[field] = Number.isFinite(n) && n !== -666666666 ? n : null;
  }

  // Derived: population 65+ summed from male and female bracket components.
  const ageBuckets = [
    'pop_male_65_66', 'pop_male_67_69', 'pop_male_70_74',
    'pop_male_75_79', 'pop_male_80_84', 'pop_male_85_plus',
    'pop_female_65_66', 'pop_female_67_69', 'pop_female_70_74',
    'pop_female_75_79', 'pop_female_80_84', 'pop_female_85_plus',
  ];
  const ageVals = ageBuckets.map(k => out[k]).filter(v => v != null);
  out.pop_65_plus = ageVals.length === ageBuckets.length
    ? ageVals.reduce((a, b) => a + b, 0)
    : null;

  // Derived: bachelor's-or-higher and graduate-or-higher counts.
  const baSum = ['edu_bachelors', 'edu_masters', 'edu_professional', 'edu_doctorate']
    .map(k => out[k]).filter(v => v != null);
  out.edu_bachelors_or_higher = baSum.length === 4
    ? baSum.reduce((a, b) => a + b, 0)
    : null;
  const gradSum = ['edu_masters', 'edu_professional', 'edu_doctorate']
    .map(k => out[k]).filter(v => v != null);
  out.edu_graduate_or_higher = gradSum.length === 3
    ? gradSum.reduce((a, b) => a + b, 0)
    : null;

  return out;
}

async function main() {
  console.log(`[start] ACS 5-Year ${VINTAGE} snapshot`);

  // Village place
  console.log('[village place 39562]');
  const villageRow = await getCensusFull('for=place:39562&in=state:36');
  const village = shape(villageRow, 'Kinderhook village, NY', 'place:39562 in state:36');

  // Town MCD
  console.log('[town MCD 39573]');
  const townRow = await getCensusFull('for=county%20subdivision:39573&in=state:36+county:021');
  const town = shape(townRow, 'Kinderhook town, Columbia County, NY', 'cousub:39573 in state:36 county:021');

  await writeSnap('village', {
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-acs.mjs',
    vintage: VINTAGE,
    source: `https://api.census.gov/data/${VINTAGE}/acs/acs5`,
    variables: ALL_VARS,
    geography: { type: 'place', state: '36', place: '39562', name: 'Kinderhook village, NY' },
    estimates: village,
  });

  await writeSnap('town', {
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-acs.mjs',
    vintage: VINTAGE,
    source: `https://api.census.gov/data/${VINTAGE}/acs/acs5`,
    variables: ALL_VARS,
    geography: { type: 'county_subdivision', state: '36', county: '021', cousub: '39573', name: 'Kinderhook town, Columbia County, NY' },
    estimates: town,
  });

  console.log(`[done] village pop=${village.population_total}  edu BA+=${village.edu_bachelors_or_higher}  65+=${village.pop_65_plus}  broadband=${village.internet_with_broadband}`);
}

main().catch(err => { console.error(err); process.exit(1); });
