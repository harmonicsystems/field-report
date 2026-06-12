#!/usr/bin/env node
/*
 * validate-audit.mjs
 *
 * Build-time validation for the AI surface audit corpus (schema/audit/).
 * Imported by build-audit-page.mjs and build-jsonld.mjs so a bad entry
 * fails every build that would publish it; also runnable standalone:
 *
 *   node tools/validate-audit.mjs
 *
 * The entry schema is v0-provisional (schema_version 0.1). Validation is
 * strict about references and enums — a query_id or entity_ref that
 * resolves to nothing is exactly the kind of rot this corpus exists to
 * catch — but tolerant of additive change: unknown extra fields pass.
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

export const SURFACES    = ['google-aio', 'ask-maps', 'claude', 'chatgpt', 'other'];
export const ASSESSMENTS = ['accurate', 'factual-error', 'omission', 'narrative-gap'];
export const STATUSES    = ['open', 'fixed-at-source', 'verified-resolved'];
// Advisory only — an unknown intent warns, never fails. The query set is
// the maintainer's instrument; the validator doesn't get a veto on it.
export const INTENTS     = ['factual', 'discovery', 'narrative'];

const ISO_DAY    = /^\d{4}-\d{2}-\d{2}$/;
const CYCLE_NAME = /^\d{4}-\d{2}$/;

async function readJson(root, rel) {
  const raw = await readFile(resolve(root, rel), 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${rel}: invalid JSON — ${e.message}`);
  }
}

/* Canonical entity slugs = places manifest ∪ hours manifest. entity_ref
 * values must resolve here; provisional hours entries count (referencing
 * an entity is not asserting its unverified hours). */
export async function loadCanonicalSlugs(root = REPO_ROOT) {
  const slugs = new Set();
  const places = await readJson(root, 'schema/places/manifest.json').catch(() => null);
  for (const p of places?.places || []) if (p.slug) slugs.add(p.slug);
  const hours = await readJson(root, 'schema/hours/manifest.json').catch(() => null);
  for (const b of hours?.businesses || []) if (b.slug) slugs.add(b.slug);
  return slugs;
}

export async function loadAuditCorpus(root = REPO_ROOT) {
  const queries = await readJson(root, 'schema/audit/queries.json');
  let cycleFiles = [];
  try {
    cycleFiles = (await readdir(resolve(root, 'schema/audit/cycles')))
      .filter(f => f.endsWith('.json'))
      .sort();
  } catch {
    /* no cycles directory yet — an empty corpus is valid */
  }
  const cycles = [];
  for (const f of cycleFiles) {
    cycles.push({ file: f, data: await readJson(root, `schema/audit/cycles/${f}`) });
  }
  return { queries, cycles };
}

export function validateAudit(corpus, canonicalSlugs) {
  const errors = [];
  const warnings = [];
  const err  = (where, msg) => errors.push(`${where}: ${msg}`);
  const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

  // --- queries.json ---
  const queryIds = new Set();
  const q = corpus.queries;
  if (!Array.isArray(q?.queries)) {
    err('queries.json', 'missing "queries" array');
  } else {
    q.queries.forEach((entry, i) => {
      const where = `queries.json[${i}]`;
      if (!entry.id || typeof entry.id !== 'string') return err(where, 'missing id');
      if (queryIds.has(entry.id)) err(where, `duplicate id "${entry.id}"`);
      queryIds.add(entry.id);
      if (!entry.query || !String(entry.query).trim()) err(where, `${entry.id}: empty query text`);
      if (entry.intent && !INTENTS.includes(entry.intent))
        warn(where, `${entry.id}: unknown intent "${entry.intent}" (known: ${INTENTS.join(', ')})`);
      if (entry.entity_refs !== undefined && !Array.isArray(entry.entity_refs))
        err(where, `${entry.id}: entity_refs must be an array`);
      for (const ref of entry.entity_refs || []) {
        if (!canonicalSlugs.has(ref))
          err(where, `${entry.id}: entity_ref "${ref}" not found in schema/places/ or schema/hours/ manifests`);
      }
    });
  }

  // --- cycle files ---
  const entryIds = new Set();
  for (const { file, data } of corpus.cycles) {
    const cycleName = basename(file, '.json');
    if (!CYCLE_NAME.test(cycleName))
      err(file, 'cycle files are named YYYY-MM.json');
    if (!data.schema_version)
      err(file, 'missing schema_version (current: "0.1")');
    if (!data.cycle)
      err(file, 'missing "cycle" field');
    else if (data.cycle !== cycleName)
      err(file, `"cycle" is "${data.cycle}" but filename says "${cycleName}"`);
    if (!Array.isArray(data.entries)) {
      err(file, 'missing "entries" array');
      continue;
    }

    data.entries.forEach((e, i) => {
      const where = `${file}[${i}]`;
      const id = e.id || '(no id)';
      if (!e.id) err(where, 'missing id');
      else {
        if (entryIds.has(e.id)) err(where, `duplicate entry id "${e.id}"`);
        entryIds.add(e.id);
        if (!e.id.startsWith(`${cycleName}-`))
          warn(where, `${id}: id doesn't start with "${cycleName}-" (convention: YYYY-MM-<query_id>-<surface>)`);
      }

      if (!e.query_id) err(where, `${id}: missing query_id`);
      else if (queryIds.size && !queryIds.has(e.query_id))
        err(where, `${id}: query_id "${e.query_id}" not found in queries.json`);

      if (!e.surface) err(where, `${id}: missing surface`);
      else if (!SURFACES.includes(e.surface))
        err(where, `${id}: surface "${e.surface}" not one of ${SURFACES.join(' | ')}`);

      if (!e.observed_at) err(where, `${id}: missing observed_at`);
      else if (!ISO_DAY.test(e.observed_at) || isNaN(Date.parse(e.observed_at)))
        err(where, `${id}: observed_at "${e.observed_at}" is not a valid YYYY-MM-DD date`);

      if (!e.observed_answer || !String(e.observed_answer).trim())
        err(where, `${id}: missing observed_answer — the observation is the point`);

      if (!e.assessment) err(where, `${id}: missing assessment`);
      else if (!ASSESSMENTS.includes(e.assessment))
        err(where, `${id}: assessment "${e.assessment}" not one of ${ASSESSMENTS.join(' | ')}`);

      if (e.cited_sources !== undefined && !Array.isArray(e.cited_sources))
        err(where, `${id}: cited_sources must be an array of URLs`);

      if (e.entity_ref && !canonicalSlugs.has(e.entity_ref))
        err(where, `${id}: entity_ref "${e.entity_ref}" not found in schema/places/ or schema/hours/ manifests`);

      // Status lifecycle. Accurate observations carry no defect to track,
      // so status is optional there; everything else needs one.
      const accurate = e.assessment === 'accurate';
      if (e.status != null && !STATUSES.includes(e.status))
        err(where, `${id}: status "${e.status}" not one of ${STATUSES.join(' | ')}`);
      if (e.status == null && !accurate)
        err(where, `${id}: non-accurate entries need a status (${STATUSES.join(' | ')})`);

      if (e.status === 'verified-resolved') {
        if (!e.resolved_at)
          err(where, `${id}: verified-resolved requires resolved_at`);
      } else if (e.resolved_at) {
        warn(where, `${id}: resolved_at set but status is "${e.status ?? 'unset'}" — flip to verified-resolved?`);
      }
      if (e.resolved_at != null) {
        if (!ISO_DAY.test(e.resolved_at) || isNaN(Date.parse(e.resolved_at)))
          err(where, `${id}: resolved_at "${e.resolved_at}" is not a valid YYYY-MM-DD date`);
        else if (e.observed_at && ISO_DAY.test(e.observed_at) && e.resolved_at < e.observed_at)
          err(where, `${id}: resolved_at ${e.resolved_at} precedes observed_at ${e.observed_at}`);
      }

      if (!accurate && !e.discrepancy)
        warn(where, `${id}: ${e.assessment} with no discrepancy text — what exactly is wrong?`);
      if ((e.status === 'fixed-at-source' || e.status === 'verified-resolved') && !e.fix_applied)
        warn(where, `${id}: status "${e.status}" but fix_applied is empty — record what was done`);
    });
  }

  return { errors, warnings };
}

/* Cycle-level summary stats — the only audit data exported downstream.
 * Full observation text never leaves schema/audit/. */
export function summarizeCycles(corpus) {
  return corpus.cycles.map(({ data }) => {
    const entries = data.entries || [];
    const byAssessment = Object.fromEntries(ASSESSMENTS.map(a => [a, 0]));
    let open = 0, fixedAtSource = 0, verifiedResolved = 0;
    for (const e of entries) {
      if (byAssessment[e.assessment] !== undefined) byAssessment[e.assessment]++;
      if (e.status === 'open') open++;
      if (e.status === 'fixed-at-source') fixedAtSource++;
      if (e.status === 'verified-resolved') verifiedResolved++;
    }
    return {
      cycle: data.cycle,
      ...(data.draft ? { draft: true } : {}),
      observations: entries.length,
      byAssessment,
      open,
      fixedAtSource,
      verifiedResolved,
    };
  });
}

/* Standalone CLI */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const [corpus, slugs] = await Promise.all([loadAuditCorpus(), loadCanonicalSlugs()]);
    const { errors, warnings } = validateAudit(corpus, slugs);
    for (const w of warnings) console.warn(`[validate-audit] warn  ${w}`);
    for (const e of errors)   console.error(`[validate-audit] ERROR ${e}`);
    if (errors.length) {
      console.error(`[validate-audit] FAILED — ${errors.length} error(s), ${warnings.length} warning(s)`);
      process.exit(1);
    }
    const obs = corpus.cycles.reduce((n, c) => n + (c.data.entries?.length || 0), 0);
    console.log(`[validate-audit] OK — ${corpus.queries.queries?.length ?? 0} queries, ${corpus.cycles.length} cycle(s), ${obs} observation(s), ${warnings.length} warning(s)`);
  } catch (e) {
    console.error(`[validate-audit] FAILED — ${e.message}`);
    process.exit(1);
  }
}
