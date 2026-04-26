#!/usr/bin/env node
/*
 * fetch-climate-smart.mjs
 *
 * Snapshots the New York State "Climate Smart Communities List of
 * Participating Local Governments" from data.ny.gov (Socrata).
 *
 * The Climate Smart Communities (CSC) program is run by the NYS
 * Department of Environmental Conservation. Local governments take a
 * pledge across ten policy categories; subsequently they earn points
 * that escalate them through Registered → Bronze → Silver → Gold.
 *
 * The dataset is small (391 jurisdictions statewide). We fetch the
 * whole thing once, then partition into:
 *   - the village of Kinderhook itself (the focal entity)
 *   - all of Columbia County (peer context for the village)
 *   - state-wide totals (for the broader frame)
 *
 * Source: https://data.ny.gov/resource/2c5p-4m2k.json
 *
 * Output: data/snapshots/climate-smart/{date,latest}.json
 *
 * Usage:  node tools/fetch-climate-smart.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR = resolve(REPO_ROOT, 'data/snapshots/climate-smart');
const SOURCE = 'https://data.ny.gov/resource/2c5p-4m2k.json';
const UA = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const COUNTY = 'Columbia';
const TOWN_NAME = 'Kinderhook';
const today = new Date().toISOString().slice(0, 10);

const STATUS_ORDER = ['Gold Certified', 'Silver Certified', 'Bronze Certified', 'Registered'];
const STATUS_RANK = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, STATUS_ORDER.length - i]));

function shape(row) {
  return {
    name: row.name_of_local_government,
    type: row.type_of_local_government,           // village | town | city | County
    status: row.status_as_a_csc,
    pledgedOn: (row.date_adopted_csc_pledge || '').slice(0, 10) || null,
    certificationExpires: (row.certification_expiration_date || '').slice(0, 10) || null,
    population2010: row.population_from_2010_census ? +row.population_from_2010_census : null,
    county: row.county,
    redcRegion: row.redc_region,
    decRegion: row.dec_regional_office,
  };
}

async function main() {
  console.log(`[start] ${SOURCE}`);
  const r = await fetch(`${SOURCE}?$limit=2000`, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status}`);
  const all = (await r.json()).map(shape);
  console.log(`  ${all.length} jurisdictions statewide`);

  // Filters.
  const county = all.filter(j => j.county === COUNTY)
    .sort((a, b) => (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0)
                  || (a.name || '').localeCompare(b.name || ''));

  const villageMatches = county.filter(j =>
    /village/i.test(j.type) && j.name === TOWN_NAME);
  const townMatches = county.filter(j =>
    /town/i.test(j.type) && j.name === TOWN_NAME);
  const village = villageMatches[0] || null;
  const town = townMatches[0] || null;

  // Statewide aggregates by status (signals participation share).
  const statewideByStatus = {};
  const countyByStatus = {};
  for (const j of all) statewideByStatus[j.status] = (statewideByStatus[j.status] || 0) + 1;
  for (const j of county) countyByStatus[j.status] = (countyByStatus[j.status] || 0) + 1;

  const snap = {
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-climate-smart.mjs',
    source: SOURCE,
    program: {
      name: 'Climate Smart Communities',
      agency: 'New York State Department of Environmental Conservation',
      url: 'https://climatesmart.ny.gov/',
      description: 'A statewide program in which local governments pledge to act across ten climate policy categories and earn points for documented actions, escalating their certification level over time.',
      statusLadder: STATUS_ORDER.slice().reverse(),
    },
    counts: {
      statewideTotal: all.length,
      statewideByStatus,
      countyTotal: county.length,
      countyByStatus,
    },
    village,                // null if village isn't enrolled
    town,                   // null if town isn't enrolled (true today!)
    countyParticipants: county,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const payload = JSON.stringify(snap, null, 2) + '\n';
  await writeFile(resolve(OUT_DIR, `${today}.json`), payload);
  await writeFile(resolve(OUT_DIR, 'latest.json'), payload);
  console.log(`[done] village: ${village?.status || '—'} (pledged ${village?.pledgedOn || '—'})`);
  console.log(`       county participants: ${county.length}, of which ${county.filter(j => /Bronze|Silver|Gold/.test(j.status)).length} are certified`);
  if (!town) console.log(`       NOTE: Town of ${TOWN_NAME} is NOT in the dataset — village is enrolled, surrounding town is not.`);
}

main().catch(err => { console.error(err); process.exit(1); });
