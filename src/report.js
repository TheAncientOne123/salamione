// Dashboard en PDF: completa la plantilla fija templates/reporte.html con el dashboard
// calculado (mismos componentes que la página) y la imprime con el navegador del sistema.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './browser.js';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { STATUS, fmt, pct } from '../public/scoring.js';
import { esc, legend, kpiCards, indicatorCards, controlCard, contextHtml, risksTable, roadmapTable, changesTable, reportedInitiatives, riskStateChip, statusChip, severityChip } from '../public/components.js';
import { versionSummary, compareVersions } from '../public/versions.js';

const ROOT = path.resolve('.');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const fecha = (iso) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

function updateSection(d, initial, analysis) {
  const last = analysis.updates?.at(-1);
  if (!last || !initial) return '';
  const c = compareVersions(versionSummary(initial), versionSummary(d));
  const box = (label, a, b, delta) =>
    `<div class="card"><p class="kpi-label">${esc(label)}</p><p class="v">${esc(a)} → ${esc(b)}</p><p class="kpi-sub">${esc(delta)}</p></div>`;
  const dl = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${fmt(x)} pts`);
  return `<section class="page">
    <h2 class="section">Cambios derivados de la nueva evidencia</h2>
    <p class="muted small">Documentos: ${esc(last.documents.join(', '))} · Aplicado: ${esc(fecha(last.at))}. Solo se aplicaron los cambios aprobados por el auditor (${last.approved.length} aprobados, ${last.pending.length} pendientes, ${last.rejected.length} rechazados). La evaluación inicial se conserva como versión.</p>
    <div class="cmp">
      ${box(`Implementación IG${d.ig}`, pct(c.implementation.a), pct(c.implementation.b), dl(c.implementation.delta))}
      ${box(`Cobertura IG${d.ig}`, pct(c.coverage.a), pct(c.coverage.b), dl(c.coverage.delta))}
      ${box('Implementadas', c.counts.implementado.a, c.counts.implementado.b, `${c.counts.implementado.delta >= 0 ? '+' : ''}${c.counts.implementado.delta}`)}
      ${box('No implementadas', c.counts.no_implementado.a, c.counts.no_implementado.b, `${c.counts.no_implementado.delta >= 0 ? '+' : ''}${c.counts.no_implementado.delta}`)}
    </div>
    ${last.initiatives?.length ? `<p class="kpi-label">Iniciativas reportadas</p>${reportedInitiatives(last.initiatives, { quotes: false, compact: true })}` : ''}
    <p class="kpi-label">Validación de cambios propuestos</p>
    ${changesTable(last.changes, { maxEvidence: 1, compact: true })}
    <p class="kpi-label">Riesgos: cuáles cambiaron y cuáles permanecen</p>
    <table class="table rtable"><thead><tr><th>ID</th><th>Riesgo</th><th>Inicial</th><th>Actualizado</th><th>Resultado</th></tr></thead><tbody>${c.risks
      .map((r) => `<tr><td class="id">${esc(r.id)}</td><td>${esc(r.title)}</td><td>${riskStateChip(r.from)}</td><td>${r.to ? riskStateChip(r.to) : '—'}</td><td>${r.changed ? 'Cambió' : 'Permanece'}</td></tr>`)
      .join('')}</tbody></table>
  </section>`;
}

export function renderReportHtml(d, { documents = [], catalog, initial = null, analysis = null }) {
  const template = read('templates/reporte.html');
  const css = read('templates/reporte.css');
  const logo = read('public/logo.svg');
  const byId = Object.fromEntries(d.safeguards.map((s) => [s.id, s]));
  const st = d.stats || {};
  const v = catalog.values;
  const an = analysis || { updates: [] };

  const data = {
    titulo: esc(`Dashboard CIS — ${d.company.name}`),
    css,
    logo,
    marco: esc(catalog.shortName),
    fechaEmision: esc(fecha(new Date().toISOString())),
    estadoVersion: esc(d.updatedAt ? 'Evaluación actualizada' : 'Evaluación inicial'),
    organizacion: esc(d.company.name === 'No informado' ? 'Organización no informada en los documentos' : d.company.name),
    sector: esc(d.company.sector === 'No informado' ? '' : `Sector: ${d.company.sector}`),
    resumen: d.summary.map((p) => `<li>${esc(p)}</li>`).join(''),
    indicadores: indicatorCards(d, initial && d.updatedAt ? { implementation: initial.implementation, coverage: initial.coverage } : null),
    kpis: kpiCards(d),
    documentos: esc(documents.length ? documents.map((x) => `${x.name} (${x.role === 'evidencia' ? 'nueva evidencia' : 'contexto'})`).join(' · ') : 'Ninguno'),
    fechaAnalisis: esc(fecha(d.generatedAt) + (d.updatedAt ? ` · actualizada ${fecha(d.updatedAt)}` : '')),
    motor: esc(d.engine),
    contexto: contextHtml(d.context, { compact: true }),
    leyenda: legend(),
    controles: d.controls.map((c) => controlCard(c, byId)).join(''),
    riesgos: risksTable(d, { compact: true }),
    roadmap: roadmapTable(d, { compact: true }),
    actualizacion: updateSection(d, initial, an),
    metodologia: [
      `Marco: ${catalog.title} — ${d.total} salvaguardas en ${d.controls.length} controles (archivo ${catalog.source}). ${catalog.scope}`,
      `Estados y valores: Implementado ${v.implementado}, Parcialmente implementado ${v.parcial}, No implementado ${v.no_implementado}; No verificado y No aplicable sin valor.`,
      `Implementación = (Implementadas + 0,5 × Parciales) / (Implementadas + Parciales + No implementadas) × 100. Cobertura = (Implementadas + Parciales + No implementadas) / (${d.total} − No aplicables) × 100.`,
      `Anti-invención: el agente solo califica salvaguardas del catálogo y solo cita documentos cargados; cada cita se verifica contra el texto original (con página o sección) y las que no coinciden se descartan.${
        st.quotes != null ? ` En la evaluación inicial: ${st.quotes - st.rejectedQuotes} citas verificadas, ${st.rejectedQuotes} descartadas, ${st.downgraded} estados degradados a "No verificado".` : ''
      }`,
      `Las ${d.counts.no_verificado} salvaguardas no verificadas no implican incumplimiento: indican que la documentación no permite afirmarlo (regla R8). Aportar evidencia sobre ellas aumentaría la cobertura.`,
      '"Implementado" es una conclusión documental provisional, sujeta a validación del auditor; no equivale a una certificación ni a una auditoría técnica.',
      `La matriz completa de las ${d.total} salvaguardas (estado, aplicabilidad, justificación, evidencia y observaciones) se descarga en Excel, para cualquier versión.`,
      catalog.note && `Nota del catálogo: ${catalog.note}`,
    ]
      .filter(Boolean)
      .map((p) => `<p>${esc(p)}</p>`)
      .join(''),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in data ? data[k] : m));
}

// ---------- impresión a PDF con el navegador instalado ----------

// El PDF del dashboard tiene un máximo de páginas (por defecto cinco). Si el contenido lo excede,
// se reduce la escala de impresión en pasos y se vuelve a contar.
export async function renderPdf(html, { footer = '', maxPages = 5 } = {}) {
  const { browser, close } = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    let pdf;
    for (let scale = 1; scale >= 0.7; scale = Math.round((scale - 0.05) * 100) / 100) {
      pdf = Buffer.from(await page.pdf({ scale,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font:8px 'Segoe UI',Arial,sans-serif;color:#7d8a80;padding:0 12mm;display:flex;justify-content:space-between">
        <span>${esc(footer)}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
      }));
      if ((await pdfParse(pdf)).numpages <= maxPages) return pdf;
    }
    return pdf; // no entró ni al 70 %: se entrega igual y el servidor lo informa

  } finally {
    await close();
  }
}

// ---------- comparación antes / después ----------

const COMPARE_CSS = `
.verdict { border-radius: 12px; padding: 14px 16px; color: #fff; display: flex; gap: 16px; align-items: center; }
.verdict.mejora { background: #1d7a3e; } .verdict.retroceso { background: #b02a2a; } .verdict.mixto, .verdict.sin_cambios { background: #4b4f57; }
.verdict .k { font-size: 22px; font-weight: 800; white-space: nowrap; } .verdict p { font-size: 10.5px; opacity: .95; }
.sides { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.sides .card .big { font-size: 22px; font-weight: 800; } .up { color: #1d7a3e; font-weight: 700; } .down { color: #b02a2a; font-weight: 700; }
.dir { font-weight: 700; font-size: 9px; text-transform: uppercase; } .dir.mejora { color: #1d7a3e; } .dir.retroceso { color: #b02a2a; } .dir.neutral { color: #80858d; }
`;

export function renderComparisonHtml(A, B, c, { company = '', shortName = '' } = {}) {
  const css = read('templates/reporte.css') + COMPARE_CSS;
  const logo = read('public/logo.svg');
  const dl = (x, suf = ' pts') => (x == null ? '—' : `<span class="${x > 0 ? 'up' : x < 0 ? 'down' : ''}">${x > 0 ? '+' : ''}${fmt(x)}${suf}</span>`);
  const order = { retroceso: 0, mejora: 1, neutral: 2, nueva: 3, eliminada: 4 };
  const changes = [...c.changes].sort((x, y) => order[x.direction] - order[y.direction] || x.id.localeCompare(y.id, 'es', { numeric: true }));
  const ctrl = c.controls.filter((x) => x.delta);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comparación — ${esc(company)}</title><style>${css}</style></head><body>
  <section class="page flow">
    <header class="band"><div class="band-logo">${logo}</div><div>
      <div class="band-title">Comparación antes / después</div>
      <div class="band-sub"><span class="b-one">Salami</span>One · ${esc(shortName)} · ${esc(company)}</div>
      <div class="band-date">Emitido el ${esc(fecha(new Date().toISOString()))}</div></div></header>
    <div class="verdict ${c.verdict.key}" style="margin-top:10px"><div class="k">${esc(c.verdict.label)}</div><p>${esc(c.verdict.text)}</p></div>
    <div class="sides" style="margin-top:10px">
      <div class="card"><p class="kpi-label">A · antes</p><p class="small">${esc(A.label)}</p><p class="big">${esc(pct(c.implementation.a))}</p><p class="kpi-sub">Implementación · cobertura ${esc(pct(c.coverage.a))}</p></div>
      <div class="card"><p class="kpi-label">B · después</p><p class="small">${esc(B.label)}</p><p class="big">${esc(pct(c.implementation.b))}</p><p class="kpi-sub">Implementación · cobertura ${esc(pct(c.coverage.b))}</p></div>
      <div class="card"><p class="kpi-label">Variación</p><p class="big">${dl(c.implementation.delta)}</p><p class="kpi-sub">Cobertura ${dl(c.coverage.delta)} · ${c.improved} mejoras · ${c.worsened} retrocesos</p></div>
    </div>
    <h2 class="section">Estados de las salvaguardas</h2>
    <table class="table"><thead><tr><th>Estado</th><th class="num">A</th><th class="num">B</th><th class="num">Δ</th></tr></thead><tbody>${Object.entries(STATUS)
      .map(([k, v]) => { const x = c.counts[k] || { a: 0, b: 0, delta: 0 }; return `<tr><td>${esc(v.long)}</td><td class="num">${x.a}</td><td class="num">${x.b}</td><td class="num">${x.delta > 0 ? '+' : ''}${x.delta}</td></tr>`; })
      .join('')}</tbody></table>
    <h2 class="section">Controles que cambiaron</h2>
    ${ctrl.length ? `<table class="table"><thead><tr><th>Control</th><th class="num">A</th><th class="num">B</th><th class="num">Δ</th></tr></thead><tbody>${ctrl
      .map((x) => `<tr><td><b>${esc(x.id)}.</b> ${esc(x.name)}</td><td class="num">${x.a == null ? 'N/D' : fmt(x.a) + '%'}</td><td class="num">${x.b == null ? 'N/D' : fmt(x.b) + '%'}</td><td class="num">${dl(x.delta, '')}</td></tr>`)
      .join('')}</tbody></table>` : '<p class="muted small">Ningún control cambió su implementación.</p>'}
    <h2 class="section">Salvaguardas que cambiaron (${changes.length})</h2>
    ${changes.length ? `<table class="table"><thead><tr><th>ID</th><th>Salvaguarda</th><th>A → B</th><th class="num">Resultado</th></tr></thead><tbody>${changes
      .map((x) => `<tr><td class="id">${esc(x.id)}</td><td>${esc(x.title)}${x.applied ? ' <span class="muted">(simulado)</span>' : ''}</td><td>${x.from ? statusChip(x.from) : '—'} → ${x.to ? statusChip(x.to) : '—'}</td><td class="num"><span class="dir ${x.direction}">${esc(x.direction)}</span></td></tr>`)
      .join('')}</tbody></table>` : '<p class="muted small">No hay diferencias de estado.</p>'}
    ${c.risks.length ? `<h2 class="section">Riesgos</h2><table class="table"><thead><tr><th>ID</th><th>Riesgo</th><th>Severidad</th><th>A → B</th><th class="num">Resultado</th></tr></thead><tbody>${c.risks
      .map((r) => `<tr><td class="id">${esc(r.id)}</td><td>${esc(r.title)}</td><td>${severityChip(r.severity)}</td><td>${riskStateChip(r.from)} → ${r.to ? riskStateChip(r.to) : '—'}</td><td class="num">${r.changed ? 'Cambió' : 'Permanece'}</td></tr>`)
      .join('')}</tbody></table>` : ''}
    <p class="muted small" style="margin-top:10px">"Mejora" = la salvaguarda pasa a un estado mejor (p. ej. de No implementado a Parcial). Pasar de No verificado a No implementado es neutral: aporta certeza, no es un retroceso. Los estados simulados no son evidencia.</p>
  </section></body></html>`;
}

export { STATUS };
