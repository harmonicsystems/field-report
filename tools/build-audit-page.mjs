#!/usr/bin/env node
/*
 * build-audit-page.mjs
 *
 * Renders /ai-audit.html — the AI surface audit — from schema/audit/.
 * Validates the corpus first and refuses to render invalid data.
 *
 * The page is generated; never hand-edit ai-audit.html. Output is
 * deterministic (no build timestamps): it changes only when the corpus
 * changes, so the weekly refresh Action produces no spurious diffs.
 *
 * Usage: node tools/build-audit-page.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  REPO_ROOT, SURFACES, ASSESSMENTS,
  loadAuditCorpus, loadCanonicalSlugs, validateAudit, summarizeCycles,
} from './validate-audit.mjs';

const SITE = 'https://fieldreports.harmonic-systems.org';
const OUT = resolve(REPO_ROOT, 'ai-audit.html');

const SURFACE_LABEL = {
  'google-aio': 'Google AI Overviews',
  'ask-maps':   'Ask Maps',
  'claude':     'Claude',
  'chatgpt':    'ChatGPT',
  'other':      'Other',
};
const SURFACE_COL = {
  'google-aio': 'AIO', 'ask-maps': 'Ask Maps', 'claude': 'Claude',
  'chatgpt': 'ChatGPT', 'other': 'Other',
};
const ASSESS_LABEL = {
  'accurate': 'accurate', 'factual-error': 'error',
  'omission': 'omission', 'narrative-gap': 'gap',
};
const STATUS_LABEL = {
  'open': 'open', 'fixed-at-source': 'fixed at source', 'verified-resolved': 'verified resolved',
};

const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

async function readJson(rel) {
  return JSON.parse(await readFile(resolve(REPO_ROOT, rel), 'utf-8'));
}

function badge(assessment, titleAttr = '') {
  return `<span class="badge b-${esc(assessment)}"${titleAttr ? ` title="${esc(titleAttr)}"` : ''}>${esc(ASSESS_LABEL[assessment] || assessment)}</span>`;
}

function stamp(status) {
  return `<span class="stamp s-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function jsonLd(corpus) {
  const realCycles = corpus.cycles.filter(c => !c.data.draft);
  const months = realCycles.map(c => c.data.cycle).sort();
  const dataset = {
    '@context': ['https://schema.org', { kh: `${SITE}/ns/kh#` }],
    '@type': 'Dataset',
    '@id': `${SITE}/ai-audit.html#dataset`,
    name: 'Kinderhook AI surface audit',
    url: `${SITE}/ai-audit.html`,
    description:
      'Monthly, hand-collected observations of what AI surfaces (Google AI Overviews, map assistants, Claude, ChatGPT) claim about the Village of Kinderhook, NY, assessed against the village’s canonical structured data, traced to source, and tracked to resolution.',
    creator: { '@type': 'Person', name: 'David Nyman' },
    spatialCoverage: { '@id': 'https://www.wikidata.org/wiki/Q3478629' },
    measurementTechnique:
      'A fixed query set is run manually against each surface once per monthly cycle; answers are transcribed by hand and assessed against the schema/ canonical corpus. No scraping, no SERP APIs, no headless browsers.',
    isBasedOn: [
      `${SITE}/schema/places/manifest.json`,
      `${SITE}/schema/hours/manifest.json`,
    ],
    ...(months.length ? { temporalCoverage: `${months[0]}/${months[months.length - 1]}` } : {}),
    distribution: [
      {
        '@type': 'DataDownload',
        name: 'Fixed query set',
        encodingFormat: 'application/json',
        contentUrl: `${SITE}/schema/audit/queries.json`,
      },
      ...corpus.cycles.map(c => ({
        '@type': 'DataDownload',
        name: `Observation cycle ${c.data.cycle}`,
        encodingFormat: 'application/json',
        contentUrl: `${SITE}/schema/audit/cycles/${c.file}`,
        ...(c.data.draft ? { 'kh:draft': true } : {}),
      })),
    ],
  };
  return JSON.stringify(dataset, null, 2);
}

function renderGrid(queries, cycle, surfaces) {
  const byCell = new Map();
  for (const e of cycle.data.entries || []) {
    const key = `${e.query_id}::${e.surface}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(e);
  }
  const head = `<tr><th class="q-col">Query</th>${surfaces.map(s =>
    `<th class="s-col">${esc(SURFACE_COL[s])}</th>`).join('')}</tr>`;
  const rows = queries.map(q => {
    const cells = surfaces.map(s => {
      const hits = byCell.get(`${q.id}::${s}`) || [];
      if (!hits.length) return '<td class="s-col empty">—</td>';
      return `<td class="s-col">${hits.map(e => badge(e.assessment, e.id)).join(' ')}</td>`;
    }).join('');
    return `<tr><td class="q-col"><span class="q-id">${esc(q.id)}</span>${esc(q.query)}</td>${cells}</tr>`;
  }).join('\n');
  return `<div class="grid-scroll"><table class="cycle-grid">\n<thead>${head}</thead>\n<tbody>\n${rows}\n</tbody></table></div>`;
}

function renderDiscrepancy(e, queryById, entityHref) {
  const q = queryById.get(e.query_id);
  const sources = (e.cited_sources || []).map(u =>
    `<a href="${esc(u)}" rel="nofollow noopener">${esc(u)}</a>`).join('<br>');
  const entity = e.entity_ref ? entityHref(e.entity_ref) : null;
  return `<article class="disc">
  <div class="disc-meta">
    <span class="disc-id">${esc(e.id)}</span>
    <span class="disc-surface">${esc(SURFACE_LABEL[e.surface] || e.surface)}</span>
    <span class="disc-date">observed ${esc(e.observed_at)}</span>
    ${stamp(e.status)}
  </div>
  <div class="disc-body">
    <p class="disc-query">&ldquo;${esc(q?.query || e.query_id)}&rdquo;</p>
    <div class="disc-answer">
      <span class="cap">Observed answer</span>
      <p>${esc(e.observed_answer)}</p>
    </div>
    ${e.discrepancy ? `<div class="disc-vs">
      <span class="cap">Observed vs. canonical</span>
      <p>${esc(e.discrepancy)}</p>
    </div>` : ''}
    <div class="disc-trail">
      ${entity ? `<div><span class="cap">Entity</span> ${entity}</div>` : ''}
      ${sources ? `<div><span class="cap">Surface cited</span> ${sources}</div>` : ''}
      ${e.traced_source ? `<div><span class="cap">Traced to</span> <a href="${esc(e.traced_source)}" rel="nofollow noopener">${esc(e.traced_source)}</a></div>` : ''}
      ${e.fix_applied ? `<div><span class="cap">Fix applied</span> ${esc(e.fix_applied)}</div>` : ''}
    </div>
  </div>
</article>`;
}

function renderTrend(summaries) {
  const max = Math.max(1, ...summaries.flatMap(s => Object.values(s.byAssessment)));
  return summaries.map(s => `<div class="trend-cycle">
  <div class="trend-label">${esc(s.cycle)}${s.draft ? ' <em>(example)</em>' : ''} · ${s.observations} observation${s.observations === 1 ? '' : 's'}</div>
  ${ASSESSMENTS.map(a => {
    const n = s.byAssessment[a] || 0;
    const w = n ? Math.max(3, Math.round((n / max) * 100)) : 0;
    return `<div class="trend-row">
    <span class="trend-k">${esc(ASSESS_LABEL[a])}</span>
    <span class="trend-bar"><span class="trend-fill f-${esc(a)}" style="width:${w}%"></span></span>
    <span class="trend-n">${n}</span>
  </div>`;
  }).join('\n')}
</div>`).join('\n');
}

async function main() {
  const [corpus, slugs] = await Promise.all([loadAuditCorpus(), loadCanonicalSlugs()]);
  const { errors, warnings } = validateAudit(corpus, slugs);
  for (const w of warnings) console.warn(`[build-audit-page] warn  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[build-audit-page] ERROR ${e}`);
    console.error(`[build-audit-page] refusing to render an invalid corpus (${errors.length} error(s))`);
    process.exit(1);
  }

  const placesManifest = await readJson('schema/places/manifest.json').catch(() => ({ places: [] }));
  const hoursManifest  = await readJson('schema/hours/manifest.json').catch(() => ({ businesses: [] }));
  const placeName = new Map(placesManifest.places.map(p => [p.slug, p.display]));
  const hoursName = new Map((hoursManifest.businesses || []).map(b => [b.slug, b.name]));
  const entityHref = (slug) => {
    if (placeName.has(slug))
      return `<a href="./schema/places/${esc(slug)}.json">${esc(placeName.get(slug))}</a>`;
    if (hoursName.has(slug))
      return `<a href="./schema/hours/manifest.json">${esc(hoursName.get(slug))}</a>`;
    return `<span class="mono">${esc(slug)}</span>`;
  };

  const queries = corpus.queries.queries || [];
  const queryById = new Map(queries.map(q => [q.id, q]));
  const cycles = [...corpus.cycles].sort((a, b) => a.file.localeCompare(b.file));
  const current = cycles[cycles.length - 1] || null;
  const summaries = summarizeCycles({ cycles });
  const currentSummary = summaries[summaries.length - 1] || null;

  const allEntries = cycles.flatMap(c => c.data.entries || []);
  const openEntries = allEntries.filter(e => e.status === 'open' || e.status === 'fixed-at-source');
  const resolved = allEntries.filter(e => e.status === 'verified-resolved');

  const surfacesInUse = SURFACES.filter(s =>
    s !== 'other' || allEntries.some(e => e.surface === 'other'));

  const draftNote = (current?.data.draft || corpus.queries.status === 'draft');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>What the Machines Say — Kinderhook AI Surface Audit</title>
<meta name="description" content="A monthly, hand-collected audit of what AI surfaces claim about the Village of Kinderhook, NY, checked against the village's canonical structured data and tracked to resolution.">
<link rel="canonical" href="${SITE}/ai-audit.html">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=Source+Serif+4:ital,opsz,wght@0,8..60,300..700;1,8..60,300..700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script type="application/ld+json">
${jsonLd(corpus)}
</script>
<style>
  :root {
    --bg: #f4efe4;
    --bg-plate: #ede7d7;
    --ink: #1a1614;
    --ink-soft: #3b342e;
    --rule: #c9c0ae;
    --rule-soft: #d8d0bc;
    --accent: #a63d2a;
    --slate: #4a5a4e;
    --warn: #8a6a1e;
    --mono: 'JetBrains Mono', ui-monospace, monospace;
    --serif: 'Source Serif 4', 'Source Serif Pro', Georgia, serif;
    --display: 'Newsreader', Georgia, serif;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--bg); color: var(--ink);
    font-family: var(--serif); font-size: 18px; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .page { max-width: 1080px; margin: 0 auto; padding: 0 40px 120px; }

  .top-banner {
    margin: 32px 0 0; padding: 14px 22px;
    background: var(--bg-plate); border: 1px solid var(--rule);
    font-family: var(--mono); font-size: 12px; line-height: 1.5; color: var(--ink-soft);
  }
  .top-banner p { margin: 0; }
  .top-banner a { color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent); }
  .top-banner a:hover { color: var(--ink); border-bottom-color: var(--ink); }
  .top-banner .back { float: right; }
  @media (max-width: 640px) { .top-banner .back { float: none; display: block; margin-top: 6px; } }

  header.masthead { padding: 64px 0 36px; border-bottom: 1px solid var(--ink); margin-bottom: 48px; position: relative; }
  .masthead::before { content: ''; position: absolute; top: 64px; left: 0; right: 0; height: 3px; background: var(--ink); }
  .masthead::after  { content: ''; position: absolute; top: 70px; left: 0; right: 0; height: 1px; background: var(--ink); }
  .slug {
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--ink-soft); padding-top: 18px;
    display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap;
  }
  .slug .vol { color: var(--accent); }
  h1.title {
    font-family: var(--display); font-weight: 400; font-variation-settings: 'opsz' 72;
    font-size: clamp(40px, 7vw, 64px); line-height: 1.02; letter-spacing: -0.015em;
    margin: 26px 0 18px;
  }
  .dek {
    font-family: var(--display); font-style: italic; font-size: 18px; color: var(--ink-soft);
    max-width: 700px; line-height: 1.45; margin: 0;
  }

  .draft-plate {
    margin: 0 0 56px; padding: 20px 24px;
    border: 1px solid var(--accent); background: rgba(166, 61, 42, 0.04);
  }
  .draft-plate .cap { color: var(--accent); }
  .draft-plate p { margin: 8px 0 0; font-size: 15px; line-height: 1.55; max-width: 760px; }

  section.plate { margin-bottom: 80px; }
  .section-head {
    display: grid; grid-template-columns: 160px 1fr auto; gap: 32px; align-items: baseline;
    padding-bottom: 20px; margin-bottom: 28px; border-bottom: 1px solid var(--ink); position: relative;
  }
  .section-head::after { content: ''; position: absolute; left: 0; right: 0; bottom: -4px; height: 1px; background: var(--ink); }
  .section-num {
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--accent); padding-top: 10px;
  }
  h2.section-title {
    font-family: var(--display); font-weight: 400; font-variation-settings: 'opsz' 60;
    font-size: 36px; line-height: 1; letter-spacing: -0.01em; margin: 0;
  }
  h2.section-title em { font-style: italic; color: var(--slate); }
  .endpoint { font-family: var(--mono); font-size: 10px; color: var(--ink-soft); letter-spacing: 0.05em; white-space: nowrap; padding-top: 12px; }
  .section-prose { max-width: 700px; margin: 0 0 26px 192px; font-size: 16px; line-height: 1.6; }
  .section-prose p { margin: 0 0 12px; }
  .section-prose a { color: var(--ink); border-bottom: 1px dotted var(--rule); text-decoration: none; }
  .section-prose a:hover { color: var(--accent); border-bottom-color: var(--accent); }
  @media (max-width: 760px) {
    .section-head { grid-template-columns: 1fr; gap: 6px; }
    .section-prose { margin-left: 0; }
  }

  .cap {
    display: block; font-family: var(--mono); font-size: 10px; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--ink-soft); margin-bottom: 4px;
  }

  .badge {
    display: inline-block; font-family: var(--mono); font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; padding: 2px 7px 3px; white-space: nowrap;
  }
  .b-accurate       { color: var(--slate); border: 1px solid var(--slate); }
  .b-factual-error  { color: var(--bg); background: var(--accent); border: 1px solid var(--accent); }
  .b-omission       { color: var(--warn); border: 1px solid var(--warn); }
  .b-narrative-gap  { color: var(--ink-soft); border: 1px dashed var(--ink-soft); }

  .stamp {
    display: inline-block; font-family: var(--mono); font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; padding: 2px 8px 3px;
  }
  .s-open              { color: var(--accent); border: 1px solid var(--accent); }
  .s-fixed-at-source   { color: var(--warn); border: 1px solid var(--warn); }
  .s-verified-resolved { color: var(--slate); border: 1px solid var(--slate); }

  .grid-scroll { overflow-x: auto; }
  table.cycle-grid { width: 100%; border-collapse: collapse; font-size: 13px; }
  .cycle-grid th, .cycle-grid td { padding: 7px 10px; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: baseline; }
  .cycle-grid th {
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--ink-soft); border-bottom: 1px solid var(--ink);
  }
  .cycle-grid td.q-col { font-size: 14px; line-height: 1.45; min-width: 260px; }
  .cycle-grid .q-id { display: block; font-family: var(--mono); font-size: 10px; color: var(--ink-soft); letter-spacing: 0.04em; }
  .cycle-grid td.s-col { white-space: nowrap; }
  .cycle-grid td.empty { color: var(--rule); font-family: var(--mono); }
  .grid-legend { margin-top: 14px; font-size: 13px; color: var(--ink-soft); font-style: italic; }
  .grid-legend .badge { margin-right: 4px; }

  article.disc { border: 1px solid var(--rule); background: rgba(255,255,255,0.35); margin-bottom: 28px; }
  .disc-meta {
    display: flex; flex-wrap: wrap; gap: 14px; align-items: baseline;
    padding: 12px 22px; border-bottom: 1px solid var(--rule-soft);
    font-family: var(--mono); font-size: 11px; color: var(--ink-soft);
  }
  .disc-id { color: var(--ink); }
  .disc-meta .stamp { margin-left: auto; }
  .disc-body { padding: 18px 22px 22px; }
  .disc-query { font-family: var(--display); font-style: italic; font-size: 20px; margin: 0 0 16px; }
  .disc-answer { border-left: 3px solid var(--rule); padding: 2px 0 2px 16px; margin: 0 0 16px; }
  .disc-answer p { margin: 0; font-size: 15px; line-height: 1.55; }
  .disc-vs { border-left: 3px solid var(--accent); padding: 2px 0 2px 16px; margin: 0 0 16px; }
  .disc-vs p { margin: 0; font-size: 15px; line-height: 1.55; }
  .disc-trail { display: grid; gap: 8px; font-size: 13px; }
  .disc-trail .cap { display: inline-block; margin: 0 8px 0 0; }
  .disc-trail a { font-family: var(--mono); font-size: 12px; color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule); word-break: break-all; }
  .disc-trail a:hover { color: var(--accent); border-bottom-color: var(--accent); }

  table.res-log { width: 100%; max-width: 880px; border-collapse: collapse; font-size: 14px; }
  .res-log th, .res-log td { padding: 8px 10px; border-bottom: 1px solid var(--rule); text-align: left; }
  .res-log th { font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); }
  .res-log td.num, .res-log th.num { text-align: right; font-family: var(--mono); }
  .res-log .mono { font-family: var(--mono); font-size: 12px; }
  .empty-note { font-style: italic; color: var(--ink-soft); font-size: 15px; }

  .trend-cycle { max-width: 720px; margin-bottom: 28px; }
  .trend-label { font-family: var(--mono); font-size: 12px; color: var(--ink); margin-bottom: 8px; }
  .trend-label em { color: var(--ink-soft); }
  .trend-row { display: grid; grid-template-columns: 90px 1fr 36px; gap: 12px; align-items: center; padding: 3px 0; }
  .trend-k { font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-soft); }
  .trend-bar { display: block; height: 12px; background: rgba(255,255,255,0.4); border: 1px solid var(--rule-soft); }
  .trend-fill { display: block; height: 100%; }
  .f-accurate { background: var(--slate); }
  .f-factual-error { background: var(--accent); }
  .f-omission { background: var(--warn); }
  .f-narrative-gap { background: var(--ink-soft); }
  .trend-n { font-family: var(--mono); font-size: 12px; text-align: right; }

  ul.files { list-style: none; padding: 0; margin: 0; max-width: 700px; }
  ul.files li { padding: 8px 0; border-bottom: 1px dotted var(--rule-soft); font-size: 14px; line-height: 1.5; }
  ul.files li:last-child { border-bottom: 0; }
  ul.files a { font-family: var(--mono); font-size: 13px; color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule); }
  ul.files a:hover { color: var(--accent); border-bottom-color: var(--accent); }

  .footer {
    margin-top: 72px; padding-top: 22px; border-top: 1px solid var(--ink);
    font-family: var(--mono); font-size: 12px; color: var(--ink-soft); line-height: 1.6;
  }
  .footer a { color: var(--ink-soft); border-bottom: 1px dotted var(--rule); text-decoration: none; }
  .footer a:hover { color: var(--accent); border-bottom-color: var(--accent); }
</style>
</head>
<body>
<main class="page">

  <div class="top-banner">
    <p>
      <span class="mono">AI SURFACE AUDIT</span> — a monthly observation log, part of the Kinderhook Field Report.
      <span class="back"><a href="./index.html">the file</a> · <a href="./audit.html">working notes</a></span>
    </p>
  </div>

  <header class="masthead">
    <div class="slug">
      <span>Harmonic Field Reports · <span class="vol">AI Surface Audit</span></span>
      <span>Kinderhook, N.Y.${current ? ` · cycle ${esc(current.data.cycle)}${current.data.draft ? ' (draft)' : ''}` : ''}</span>
    </div>
    <h1 class="title">What the machines say</h1>
    <p class="dek">A fixed set of ${queries.length} questions about the village, asked by hand each month of the surfaces people actually consult — Google's AI Overviews, map assistants, Claude, ChatGPT — and read against the village's canonical structured data. Errors are traced to their source, fixed there, and tracked until the surface answers correctly.</p>
  </header>

${draftNote ? `  <div class="draft-plate">
    <span class="cap">Draft — example cycle</span>
    <p>The observations below are illustrative placeholders demonstrating the capture format; none records a real answer from any AI surface, and the example.com citations are deliberate stand-ins. The query set is likewise draft until the first real pass finalizes it. Nothing on this page is yet a claim about what any machine actually says.</p>
  </div>
` : ''}
  <section class="plate" id="cycle">
    <div class="section-head">
      <div class="section-num">§ I · Current cycle</div>
      <h2 class="section-title">The grid, <em>as observed</em></h2>
      <div class="endpoint">${current ? `${esc(current.data.cycle)} · ${(current.data.entries || []).length} observations` : 'no cycles yet'}</div>
    </div>
${current ? renderGrid(queries, current, surfacesInUse) : '    <p class="empty-note">No observation cycles recorded yet.</p>'}
    <p class="grid-legend">${ASSESSMENTS.map(a => badge(a)).join(' ')} — an em-dash means the query hasn't been run on that surface this cycle.</p>
  </section>

  <section class="plate" id="open">
    <div class="section-head">
      <div class="section-num">§ II · Open discrepancies</div>
      <h2 class="section-title">What's wrong, <em>and where it came from</em></h2>
      <div class="endpoint">${openEntries.length} unresolved</div>
    </div>
${openEntries.length
    ? openEntries.map(e => renderDiscrepancy(e, queryById, entityHref)).join('\n')
    : '    <p class="empty-note">Nothing open — every recorded discrepancy has been resolved and verified.</p>'}
  </section>

  <section class="plate" id="resolved">
    <div class="section-head">
      <div class="section-num">§ III · Resolution log</div>
      <h2 class="section-title">Fixed, <em>and verified fixed</em></h2>
      <div class="endpoint">${resolved.length} resolved</div>
    </div>
${resolved.length ? `    <table class="res-log">
      <thead><tr><th>Observation</th><th>Surface</th><th>Observed</th><th>Verified resolved</th><th class="num">Days</th></tr></thead>
      <tbody>
${resolved.map(e => `        <tr>
          <td><span class="mono">${esc(e.id)}</span><br>${esc(queryById.get(e.query_id)?.query || '')}</td>
          <td>${esc(SURFACE_LABEL[e.surface] || e.surface)}</td>
          <td class="mono">${esc(e.observed_at)}</td>
          <td class="mono">${esc(e.resolved_at)}</td>
          <td class="num">${daysBetween(e.observed_at, e.resolved_at)}</td>
        </tr>`).join('\n')}
      </tbody>
    </table>` : '    <p class="empty-note">No entries have reached verified-resolved yet.</p>'}
  </section>

  <section class="plate" id="trend">
    <div class="section-num" style="margin-bottom:28px;">§ IV · Trend</div>
${renderTrend(summaries) || '    <p class="empty-note">Trends appear once two or more cycles exist.</p>'}
  </section>

  <section class="plate" id="method">
    <div class="section-head">
      <div class="section-num">§ V · Method</div>
      <h2 class="section-title">By hand, <em>on purpose</em></h2>
      <div class="endpoint">schema_version 0.1 · provisional</div>
    </div>
    <div class="section-prose">
      <p>Collection is manual and stays manual: a person runs each query on each surface once a month, transcribes what the machine said, and assesses it against the canonical corpus in <a href="https://github.com/harmonicsystems/field-report/tree/main/schema">schema/</a>. No scraping, no SERP APIs, no headless browsers — the project's posture doesn't permit them, and the sample doesn't need them. Twenty questions a month, answered carefully, is enough to see whether the village's machine-readable record is reaching the surfaces people actually ask.</p>
      <p>A discrepancy moves through three states: <em>open</em> (observed and logged), <em>fixed at source</em> (the stale upstream page corrected, or our canonical corpus extended to cover the gap), and <em>verified resolved</em> (a later cycle shows the surface now answering correctly). The fix always happens in the canonical corpora — <span class="mono" style="font-size:13px;">schema/places/</span>, <span class="mono" style="font-size:13px;">schema/hours/</span> — through the normal editorial flow; this audit only points.</p>
      <p>Cycle-level counts are exported to <a href="./kinderhook.json">kinderhook.json</a> under a top-level <span class="mono" style="font-size:13px;">audit</span> block. Full observation text stays here, in <span class="mono" style="font-size:13px;">schema/audit/</span> — an observation is a claim about an AI surface at a moment in time, not a fact about the village.</p>
      <span class="cap" style="margin-top:20px;">The corpus</span>
      <ul class="files">
        <li><a href="./schema/audit/queries.json">schema/audit/queries.json</a> — the fixed query set${corpus.queries.status === 'draft' ? ' (draft)' : ''}</li>
${cycles.map(c => `        <li><a href="./schema/audit/cycles/${esc(c.file)}">schema/audit/cycles/${esc(c.file)}</a> — cycle ${esc(c.data.cycle)}${c.data.draft ? ' (draft example)' : ''}</li>`).join('\n')}
        <li><a href="https://github.com/harmonicsystems/field-report/blob/main/schema/audit/TEMPLATE.md">schema/audit/TEMPLATE.md</a> — the capture template observations are logged with</li>
      </ul>
    </div>
  </section>

  <div class="footer">
    <p>Generated by <span style="color:var(--ink);">tools/build-audit-page.mjs</span> from <span style="color:var(--ink);">schema/audit/</span> — hand-collected, machine-checked. Maintained by David Nyman, Kinderhook NY.</p>
    <p><a href="./index.html">kinderhook.json, introduced</a> · <a href="./audit.html">the working notes</a> · <a href="./llms.txt">llms.txt</a> · <a href="https://github.com/harmonicsystems/field-report">source</a> · corrections via <a href="https://github.com/harmonicsystems/field-report/issues">GitHub issues</a> or <a href="mailto:davenyman@gmail.com">davenyman@gmail.com</a></p>
  </div>

</main>
</body>
</html>
`;

  await writeFile(OUT, html);
  const obs = allEntries.length;
  console.log(`[build-audit-page] wrote ${OUT}  (${cycles.length} cycle(s), ${obs} observation(s), ${openEntries.length} open)`);
}

main().catch(err => { console.error('[build-audit-page] FAILED:', err.message); process.exit(1); });
