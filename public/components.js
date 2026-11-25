// Componentes HTML compartidos por el dashboard (navegador) y la plantilla del PDF (servidor).
// Son funciones puras que devuelven strings: así el PDF es una copia fiel del dashboard.
import { STATUS, APPLICABILITY, SEVERITY, EFFORT, INIT_TYPE, RISK_STATE, INIT_STATE, fmt, pct } from './scoring.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const statusChip = (st, long = false) => `<span class="chip ${STATUS[st].key}">${esc(long ? STATUS[st].long : STATUS[st].label)}</span>`;
const SEV_KEY = { alta: 'critico', media: 'alto', baja: 'medio' };
export const severityChip = (s) => `<span class="chip ${SEV_KEY[s] || 'nd'}">${esc(SEVERITY[s] || s)}</span>`;
const RISK_KEY = { vigente: 'critico', reducido: 'medio', mitigado: 'bajo' };
export const riskStateChip = (s) => `<span class="chip ${RISK_KEY[s]}">${esc(RISK_STATE[s])}</span>`;
const INIT_KEY = { pendiente: 'nd', en_progreso: 'medio', completada: 'bajo' };
export const initStateChip = (p) => `<span class="chip ${INIT_KEY[p.state]}">${esc(INIT_STATE[p.state])} · ${fmt(p.pct)}%</span>`;

const cut = (t, n) => {
  const x = String(t || '');
  return n && x.length > n ? x.slice(0, n - 1).trimEnd() + '…' : x;
};

export const refText = (e) => `${e.document}${e.ref ? `, ${e.ref}` : ''}`;

export const legend = () =>
  Object.entries(STATUS)
    .map(([k, v]) => `<span><i class="sq ${k}"></i>${esc(v.label)}</span>`)
    .join('');

/** Dashboard ejecutivo (etapa 4.3): cobertura, implementación, riesgos e iniciativas. */
export function indicatorCards(d, initial = null) {
  const vs = (now, before) =>
    initial && before !== now ? `<p class="kpi-sub">Inicial: ${esc(pct(before))}</p>` : '';
  return `
    <div class="card ind">
      <p class="kpi-label">Cobertura IG${d.ig || 1}</p>
      <p class="ind-value">${esc(pct(d.coverage))}</p>
      <p class="kpi-sub">${d.evaluable} de ${d.total - d.counts.no_aplicable} salvaguardas evaluadas con información suficiente</p>
      ${vs(d.coverage, initial?.coverage)}
    </div>
    <div class="card ind">
      <p class="kpi-label">Implementación IG${d.ig || 1}</p>
      <p class="ind-value">${esc(pct(d.implementation))}</p>
      <p class="kpi-sub">Sobre ${d.evaluable} salvaguardas evaluables (I + 0,5·P) / (I + P + N)</p>
      ${vs(d.implementation, initial?.implementation)}
    </div>
    <div class="card ind">
      <p class="kpi-label">Riesgos prioritarios</p>
      <p class="ind-value">${d.risks.length}</p>
      <p class="kpi-sub">${d.risks.filter((r) => r.state === 'vigente').length} vigentes · ${d.risks.filter((r) => r.state === 'reducido').length} reducidos · ${d.risks.filter((r) => r.state === 'mitigado').length} mitigados</p>
    </div>
    <div class="card ind">
      <p class="kpi-label">Iniciativas</p>
      <p class="ind-value">${d.initiatives.length}</p>
      <p class="kpi-sub">${d.initiatives.filter((i) => i.type === 'quick_win').length} quick wins · ${d.initiatives.filter((i) => i.progress.state !== 'pendiente').length} con avance</p>
    </div>`;
}

/** Conteos por estado. */
export function kpiCards(d) {
  return Object.entries(STATUS)
    .map(([k, v]) => {
      const diff = d.counts[k] - d.baseCounts[k];
      return `<div class="card kpi">
        <p class="kpi-label"><span class="sq ${k}"></span>${esc(v.long)}</p>
        <p class="kpi-value">${d.counts[k]}<span class="kpi-of">/ ${d.total}</span></p>
        <p class="kpi-sub">${diff ? `${diff > 0 ? '+' : ''}${diff} por simulación` : 'según evidencia'}</p>
      </div>`;
    })
    .join('');
}

/** Tarjeta de un control del catálogo. Se adapta a cualquier cantidad de salvaguardas. */
export function controlCard(c, byId, { interactive = false } = {}) {
  const cells = c.safeguards
    .map((id) => {
      const s = byId[id];
      const tip = `<strong>${esc(s.id)} · ${esc(s.title)}</strong>${esc(STATUS[s.status].long)}${s.overridden ? ` (simulado; según evidencia: ${esc(STATUS[s.documented].long)})` : ''}`;
      const cls = `cell ${s.status}${s.overridden ? ' overridden' : ''}`;
      return interactive
        ? `<button class="${cls}" data-goto="${s.id}" data-tip="${esc(tip)}" aria-label="${esc(s.id)} ${esc(s.title)}: ${esc(STATUS[s.status].long)}">${esc(s.id)}</button>`
        : `<span class="${cls}">${esc(s.id)}</span>`;
    })
    .join('');
  const n = c.counts;
  return `<div class="card ctrl"${interactive ? ` data-ctrl="${c.id}"` : ''}>
    <div class="ctrl-head"><span class="ctrl-id">${esc(c.id)}</span><span class="ctrl-name">${esc(c.name)}</span></div>
    <div class="ctrl-score">
      <span class="val">${c.implementation == null ? 'N/D' : `${fmt(c.implementation)}<small>%</small>`}</span>
      <span class="chip ${c.label.key}">${esc(c.label.label)}</span>
    </div>
    <div class="ctrl-bar">
      <div class="fill" style="width:${c.implementation ?? 0}%;background:var(--s-${c.label.key})"></div>
      ${c.baseImplementation != null && c.baseImplementation !== c.implementation ? `<div class="ghost" style="left:calc(${c.baseImplementation}% - 0.75px)"></div>` : ''}
    </div>
    <div class="ctrl-cells">${cells}</div>
    <div class="ctrl-foot"><span>Cobertura ${esc(pct(c.coverage))}</span><span>${n.implementado}·${n.parcial}·${n.no_implementado}·${n.no_verificado}${n.no_aplicable ? `·${n.no_aplicable}` : ''}</span></div>
  </div>`;
}

export const evidenceHtml = (s) =>
  s.evidence.map((e) => `<blockquote class="evidence">“${esc(e.quote)}” <cite>— ${esc(refText(e))}</cite></blockquote>`).join('');

/** Ficha de contexto (etapa 2.3). */
export function contextHtml(ctx, { compact = false } = {}) {
  if (!ctx) return '<p class="muted small">Sin ficha de contexto.</p>';
  return `<div class="ctx-grid">${ctx.dimensions
    .map(
      (dim) => `<div class="ctx-dim${dim.id === 'restricciones' ? ' ctx-limits' : ''}">
        <p class="ctx-title">${esc(dim.name)}</p>
        ${dim.findings.length ? `<ul class="ctx-list">${dim.findings
          .slice(0, compact ? 2 : 5)
          .map((f) => `<li>${esc(compact ? cut(f.statement, 150) : f.statement)} <span class="ctx-ref">[${esc(refText(f.evidence[0]))}]</span></li>`)
          .join('')}</ul>` : ''}
        ${dim.missing.length ? `<ul class="ctx-list ctx-missing">${dim.missing.slice(0, compact ? 1 : 5).map((m) => `<li>${esc(compact ? cut(m, 150) : m)}</li>`).join('')}</ul>` : ''}
      </div>`
    )
    .join('')}</div>`;
}

/** Cinco riesgos principales (etapa 4.1). */
export function risksTable(d, { compact = false } = {}) {
  const c = (t, n) => esc(compact ? cut(t, n) : t);
  if (!d.risks.length) return '<p class="muted small">No se identificaron riesgos con brechas confirmadas.</p>';
  return `<table class="table rtable"><thead><tr><th>ID</th><th>Riesgo</th><th>Activo / proceso</th><th>Deficiencia</th><th>Consecuencia</th><th>Severidad</th><th>Estado</th></tr></thead><tbody>${d.risks
    .map(
      (r) => `<tr>
        <td class="id">${esc(r.id)}</td>
        <td><strong>${esc(r.title)}</strong>${compact ? '' : `<div class="sub">${esc(r.description)}</div>`}<div class="sub">${c(r.justification, 160)}</div></td>
        <td>${c(r.asset, 90)}</td>
        <td>${c(r.deficiency, 160)}<div class="sub">Salvaguardas: ${r.linked.map((s) => esc(s.id)).join(', ')}</div></td>
        <td>${c(r.consequence, 140)}</td>
        <td>${severityChip(r.severity)}</td>
        <td>${riskStateChip(r.state)}</td>
      </tr>`
    )
    .join('')}</tbody></table>`;
}

/** Roadmap de cinco iniciativas (etapa 4.2). */
export function roadmapTable(d, { compact = false } = {}) {
  const c = (t, n) => esc(compact ? cut(t, n) : t);
  if (!d.initiatives.length) return '<p class="muted small">Sin iniciativas propuestas.</p>';
  return `<table class="table rtable"><thead><tr><th>Prioridad</th><th>Iniciativa</th><th>Riesgo</th><th>Salvaguardas</th><th>Beneficio</th><th>Esfuerzo</th><th>Tipo</th><th>Avance</th></tr></thead><tbody>${d.initiatives
    .map(
      (i) => `<tr>
        <td class="id">${i.priority}</td>
        <td><strong>${esc(i.name)}</strong><div class="sub">${c(i.description, 150)}</div></td>
        <td>${esc(i.risks.join(', ') || '—')}</td>
        <td>${i.safeguards.map(esc).join(', ')}</td>
        <td>${c(i.benefit, 140)}</td>
        <td>${esc(EFFORT[i.effort])}</td>
        <td><span class="type ${i.type}">${esc(INIT_TYPE[i.type])}</span></td>
        <td>${initStateChip(i.progress)}</td>
      </tr>`
    )
    .join('')}</tbody></table>`;
}

const DECISION = { pendiente: 'Pendiente de validación', aprobado: 'Aprobado', rechazado: 'Rechazado', sin_cambio: 'Sin cambio (evidencia insuficiente)' };

/** Tabla de cambios propuestos por nueva evidencia (etapa 5.4). */
export function changesTable(changes, { interactive = false, maxEvidence = 3, compact = false } = {}) {
  const c2 = (t, n) => esc(compact ? cut(t, n) : t);
  if (!changes.length) return '<p class="muted small">La nueva evidencia no afecta ninguna salvaguarda.</p>';
  return `<table class="table rtable"><thead><tr><th>Salvaguarda</th><th>Estado inicial</th><th>Estado propuesto</th><th>Justificación y evidencia</th><th>Validación</th></tr></thead><tbody>${changes
    .map(
      (c) => `<tr class="dec-${c.decision}">
        <td class="id">${esc(c.id)}</td>
        <td>${statusChip(c.from, true)}</td>
        <td>${statusChip(c.proposed, true)}</td>
        <td>${c2(c.justification, 200)}${c.pending ? `<div class="sub">Pendiente: ${c2(c.pending, 140)}</div>` : ''}${c.evidence
          .slice(0, maxEvidence)
          .map((e) => `<blockquote class="evidence">“${c2(e.quote, 160)}” <cite>— ${esc(refText(e))}</cite></blockquote>`)
          .join('')}</td>
        <td>${
          interactive && c.decision !== 'sin_cambio'
            ? `<div class="seg dec" role="radiogroup" aria-label="Validación de ${esc(c.id)}">${['aprobado', 'pendiente', 'rechazado']
                .map((k) => `<button data-decide="${esc(c.id)}" data-decision="${k}" class="${c.decision === k ? 'on' : ''}" role="radio" aria-checked="${c.decision === k}">${{ aprobado: 'Aprobar', pendiente: 'Pendiente', rechazado: 'Rechazar' }[k]}</button>`)
                .join('')}</div>`
            : `<span class="dec-label">${esc(DECISION[c.decision])}</span>`
        }</td>
      </tr>`
    )
    .join('')}</tbody></table>`;
}

/** Análisis de las iniciativas reportadas (etapa 5.3). */
export function reportedInitiatives(list, { quotes = true, compact = false } = {}) {
  const c3 = (t, n) => esc(compact ? cut(t, n) : t);
  if (!list?.length) return '';
  return `<div class="rep-grid">${list
    .map(
      (i) => `<div class="card rep">
        <p class="ctx-title">${esc(i.name)} <span class="chip ${i.completeness === 'completa' ? 'bajo' : 'medio'}">${i.completeness === 'completa' ? 'Completa' : 'Parcial'}</span></p>
        <p class="small"><strong>Qué mejoró:</strong> ${c3(i.improved || '—', 170)}</p>
        <p class="small"><strong>Salvaguardas:</strong> ${esc(i.safeguards.join(', ') || 'ninguna identificada')}</p>
        <p class="small"><strong>Riesgos que podría reducir:</strong> ${esc((i.risks || []).join(', ') || '—')}</p>
        ${i.pending ? `<p class="small"><strong>Pendiente:</strong> ${c3(i.pending, 170)}</p>` : ''}
        ${quotes ? i.evidence.map((e) => `<blockquote class="evidence">“${esc(e.quote)}” <cite>— ${esc(refText(e))}</cite></blockquote>`).join('') : ''}
      </div>`
    )
    .join('')}</div>`;
}

export { APPLICABILITY };
