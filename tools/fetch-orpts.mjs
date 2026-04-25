#!/usr/bin/env node
/*
 * fetch-orpts.mjs
 *
 * Snapshots the NY ORPTS (Office of Real Property Tax Services) data the
 * §XIII Assessments section reads. Two slices:
 *
 *   1. Parcel-level assessment roll      (resource 7vem-aaz7)
 *      Filtered to the two SWIS codes that cover Kinderhook:
 *        104401 — Village of Kinderhook
 *        104489 — Town of Kinderhook outside village
 *      One record per parcel, with assessed value, full market value,
 *      property class, owner, and address.
 *
 *   2. Residential Assessment Ratio time series  (resource bsmp-6um6)
 *      The state's official ratio between assessed and market value for
 *      residential property in this jurisdiction, going back to 1982.
 *      Drives the assessment calculator in §XIII.
 *
 * Source:  https://data.ny.gov  (Socrata public, no key required)
 * Output:  data/snapshots/orpts/{date,latest}-{slice}.json
 *
 * Usage:   node tools/fetch-orpts.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR   = resolve(REPO_ROOT, 'data/snapshots/orpts');
const UA        = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const today     = new Date().toISOString().slice(0, 10);

const SWIS = {
  village: '104401',
  townOutside: '104489',
};

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function getAll(base, where) {
  const out = [];
  const page = 1000;
  for (let off = 0; off < 50000; off += page) {
    const url = `${base}?$where=${encodeURIComponent(where)}&$limit=${page}&$offset=${off}&$order=swis_code`;
    const batch = await getJson(url);
    out.push(...batch);
    if (batch.length < page) break;
  }
  return out;
}

async function writeSnap(name, data) {
  await mkdir(OUT_DIR, { recursive: true });
  const payload = JSON.stringify(data, null, 2) + '\n';
  await writeFile(resolve(OUT_DIR, `${today}-${name}.json`),  payload);
  await writeFile(resolve(OUT_DIR, `latest-${name}.json`),    payload);
}

const meta = (extra) => ({ fetchedAt: new Date().toISOString(), fetcher: 'tools/fetch-orpts.mjs', ...extra });

async function main() {
  console.log('[start] ORPTS snapshot pass');

  // --- 1. Parcel-level assessments ---
  console.log('[parcels]');
  const parcelBase = 'https://data.ny.gov/resource/7vem-aaz7.json';
  // The dataset carries multiple roll years; pin to the latest one we see
  // for this jurisdiction so a snapshot is one year, comparable diff-to-diff.
  const latestYear = (await getJson(`${parcelBase}?$select=max(roll_year)&swis_code=${SWIS.village}`))[0]?.max_roll_year;
  const where = `swis_code in("${SWIS.village}","${SWIS.townOutside}") AND roll_year='${latestYear}'`;
  const parcels = await getAll(parcelBase, where);
  console.log(`  ${parcels.length} parcels across ${Object.keys(SWIS).length} SWIS codes (roll year ${latestYear})`);

  // Tally the property-class distribution and assessed-value summary.
  const byClass = {};
  let assessedSum = 0, marketSum = 0;
  let villageCount = 0, townOutsideCount = 0;
  for (const p of parcels) {
    const code = p.property_class;
    if (!byClass[code]) byClass[code] = { code, description: p.property_class_description, count: 0, assessedTotal: 0 };
    byClass[code].count += 1;
    const a = Number(p.assessment_total) || 0;
    byClass[code].assessedTotal += a;
    assessedSum += a;
    marketSum   += Number(p.full_market_value) || 0;
    if (p.swis_code === SWIS.village) villageCount += 1;
    else if (p.swis_code === SWIS.townOutside) townOutsideCount += 1;
  }
  const classes = Object.values(byClass).sort((a, b) => b.count - a.count);

  await writeSnap('parcels', {
    ...meta({
      source: `${parcelBase}?$where=${where}`,
      swis: SWIS,
      datasetTitle: 'Property Assessment Data from Local Assessment Rolls',
      datasetId: '7vem-aaz7',
    }),
    rollYear: parcels[0]?.roll_year || null,
    counts: {
      total: parcels.length,
      village: villageCount,
      townOutsideVillage: townOutsideCount,
    },
    summary: {
      assessedTotalUSD: assessedSum,
      fullMarketTotalUSD: marketSum,
      ratio: marketSum > 0 ? +(assessedSum / marketSum).toFixed(4) : null,
    },
    propertyClasses: classes,
    parcels,
  });

  // --- 2. Residential Assessment Ratio time series ---
  console.log('[rar]');
  const rarBase = 'https://data.ny.gov/resource/bsmp-6um6.json';
  // Include the town-level SWIS too: after the village dissolved its assessing
  // function, the state reports only one RAR for the town as a whole (104400),
  // and that's the only modern series available for parcels inside the village.
  const rarWhere = `swis_code in("${SWIS.village}","${SWIS.townOutside}","104400")`;
  const rar = await getJson(`${rarBase}?$where=${encodeURIComponent(rarWhere)}&$limit=5000&$order=rate_year DESC`);
  console.log(`  ${rar.length} ratio records (back to ${rar[rar.length - 1]?.rate_year || '?'})`);

  // Group by SWIS for chart-friendly access.
  const series = {};
  for (const r of rar) {
    const k = r.swis_code;
    if (!series[k]) series[k] = [];
    series[k].push({ year: Number(r.rate_year), ratio: Number(r.residential_assessment_ratio) });
  }
  for (const k of Object.keys(series)) series[k].sort((a, b) => a.year - b.year);

  await writeSnap('rar', {
    ...meta({
      source: `${rarBase}?$where=${rarWhere}`,
      swis: SWIS,
      datasetTitle: 'Residential Assessment Ratios: Beginning Rate Year 1982',
      datasetId: 'bsmp-6um6',
      note: 'Residential Assessment Ratio (RAR) = the official ratio between assessed value and full market value for residential property. AssessedValue / RAR ≈ market value as the state computes it.',
    }),
    series,
    latest: {
      [SWIS.village]:     series[SWIS.village]?.slice(-1)[0]     || null,
      [SWIS.townOutside]: series[SWIS.townOutside]?.slice(-1)[0] || null,
      '104400':           series['104400']?.slice(-1)[0]         || null,
    },
  });

  console.log('[done] ORPTS snapshot pass');
}

main().catch(err => { console.error(err); process.exit(1); });
