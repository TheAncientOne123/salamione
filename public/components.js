// Componentes HTML compartidos por el dashboard (navegador) y la plantilla del PDF (servidor).
// Son funciones puras que devuelven strings: así el PDF es una copia fiel del dashboard.
import { STATUS, fmt } from './scoring.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const statusChip = (st) => `<span class="chip ${STATUS[st].key}">${esc(STATUS[st].label)}</span>`;

export const legend = () =>
  Object.entries(STATUS)
    .map(([k, v]) => `<span><i class="sq ${k}"></i>${esc(v.label)}</span>`)
    .join('');

/** Tarjetas de conteo por estado (se generan a partir de los estados definidos). */
export function kpiCards(d) {
  return Object.entries(STATUS)
    .map(([k, v]) => {
      const diff = d.counts[k] - d.baseCounts[k];
      return `<div class="card kpi">
        <p class="kpi-label"><span class="sq ${k}"></span>${esc(v.label)}</p>
        <p class="kpi-value">${d.counts[k]}<span class="kpi-of">/ ${d.total}</span></p>
        <p class="kpi-sub">${diff ? `${diff > 0 ? '+' : ''}${diff} vs. documentación` : 'según documentación'}</p>
      </div>`;
    })
    .join('');
}

/**
 * Tarjeta de un control del catálogo: puntaje, barra (actual + marca de lo documentado),
 * una celda por salvaguarda y peso. Se adapta a cualquier cantidad de salvaguardas.
 */
export function controlCard(c, byId, { interactive = false } = {}) {
  const cells = c.safeguards
    .map((id) => {
      const s = byId[id];
      const tip = `<strong>${esc(s.id)} · ${esc(s.title)}</strong>${esc(STATUS[s.status].label)}${
        s.overridden ? ` (aplicado; según documentación: ${esc(STATUS[s.documented].label)})` : ''
      }`;
      const cls = `cell ${s.status}${s.overridden ? ' overridden' : ''}`;
      return interactive
        ? `<button class="${cls}" data-goto="${s.id}" data-tip="${esc(tip)}" aria-label="${esc(s.id)} ${esc(s.title)}: ${esc(STATUS[s.status].label)}">${esc(s.id)}</button>`
        : `<span class="${cls}">${esc(s.id)}</span>`;
    })
    .join('');
  const delta = Math.round((c.score - c.baseScore) * 10) / 10;
  return `<div class="card ctrl"${interactive ? ` data-ctrl="${c.id}"` : ''}>
    <div class="ctrl-head"><span class="ctrl-id">${esc(c.id)}</span><span class="ctrl-name">${esc(c.name)}</span></div>
    <div class="ctrl-score">
      <span class="val">${fmt(c.score)}<small>/100</small>${delta > 0 ? ` <small class="delta-up">+${fmt(delta)}</small>` : ''}</span>
      <span class="chip ${c.label.key}">${esc(c.label.label)}</span>
    </div>
    <div class="ctrl-bar">
      <div class="fill" style="width:${Math.max(0, c.score)}%;background:var(--s-${c.label.key})"></div>
      ${c.baseScore !== c.score ? `<div class="ghost" style="left:calc(${c.baseScore}% - 0.75px)"></div>` : ''}
    </div>
    <div class="ctrl-cells">${cells}</div>
    <div class="ctrl-foot"><span>${c.safeguards.length} salvaguarda${c.safeguards.length === 1 ? '' : 's'}</span><span>peso ${fmt(c.weightPct)}%</span></div>
  </div>`;
}

export const evidenceHtml = (s) =>
  s.evidence.map((e) => `<blockquote class="evidence">“${esc(e.quote)}” <cite>— ${esc(e.document)}</cite></blockquote>`).join('');
