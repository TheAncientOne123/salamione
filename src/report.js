// PDF ejecutivo: completa la plantilla fija templates/reporte.html con el dashboard calculado
// (usando los mismos componentes que la página) y la imprime con el navegador del sistema.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { STATUS, fmt } from '../public/scoring.js';
import { esc, statusChip, legend, kpiCards, controlCard, evidenceHtml } from '../public/components.js';

const ROOT = path.resolve('.');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

export function renderReportHtml(d, { documents = [], catalog }) {
  const template = read('templates/reporte.html');
  const css = read('templates/reporte.css');
  const logo = read('public/logo.svg');
  const byId = Object.fromEntries(d.safeguards.map((s) => [s.id, s]));
  const fecha = (iso) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  const delta = Math.round((d.index - d.baseIndex) * 10) / 10;
  const st = d.stats || {};
  const v = catalog.values;

  const data = {
    titulo: esc(`Informe ejecutivo — ${d.company.name}`),
    css,
    logo,
    marco: esc(catalog.shortName),
    fechaEmision: esc(fecha(new Date().toISOString())),
    organizacion: esc(d.company.name === 'No informado' ? 'Organización no informada en los documentos' : d.company.name),
    sector: esc(d.company.sector === 'No informado' ? '' : `Sector: ${d.company.sector}`),
    resumen: d.summary.map((p) => `<li>${esc(p)}</li>`).join(''),
    indice: esc(fmt(d.index)),
    indiceClase: d.label.key,
    indiceEtiqueta: esc(d.label.label),
    indicePct: String(d.index),
    indiceBasePct: String(d.baseIndex),
    indiceDelta: delta
      ? `Según documentación: <strong>${fmt(d.baseIndex)}</strong> · <span class="delta-up">+${fmt(delta)} pts por controles aplicados</span>`
      : 'Estado según la documentación provista.',
    kpis: kpiCards(d),
    documentos: esc(documents.length ? documents.map((x) => x.name).join(' · ') : 'Ninguno'),
    fechaAnalisis: esc(fecha(d.generatedAt)),
    motor: esc(d.engine),
    alcance: esc(catalog.scope || catalog.title),
    leyenda: legend(),
    controles: d.controls.map((c) => controlCard(c, byId)).join(''),
    prioridades: d.priorities.length
      ? d.priorities
          .slice(0, 15)
          .map(
            (s) => `<tr><td class="id">${esc(s.id)}</td><td>${esc(s.title)}</td><td class="ctl">${esc(s.controlId)}. ${esc(s.controlName)}</td><td>${statusChip(s.status)}</td><td class="num delta-up">+${fmt(s.gain)} pts</td></tr>`
          )
          .join('')
      : '<tr><td colspan="5">No hay salvaguardas pendientes.</td></tr>',
    detalle: d.controls
      .map(
        (c) => `<div class="group">
          <div class="group-head"><strong>${esc(c.id)}. ${esc(c.name)}</strong><span>${fmt(c.score)}/100 · peso ${fmt(c.weightPct)}%</span></div>
          ${c.safeguards
            .map((id) => {
              const s = byId[id];
              return `<div class="sg">
                <span class="id">${esc(s.id)}</span>
                <div><div class="title">${esc(s.title)}</div>${evidenceHtml(s)}${
                  s.overridden ? `<div class="applied">Aplicado manualmente. Según documentación: ${esc(STATUS[s.documented].label)}.</div>` : ''
                }</div>
                <div>${statusChip(s.status)}</div>
              </div>`;
            })
            .join('')}
        </div>`
      )
      .join(''),
    metodologia: [
      `Marco: ${catalog.title} — ${d.total} salvaguardas en ${d.controls.length} controles (archivo ${catalog.source}).`,
      catalog.scope,
      `Valor por estado: ${Object.keys(STATUS).map((k) => `${STATUS[k].label} ${v[k]}`).join(' · ')}. El puntaje de cada control es el promedio de sus salvaguardas; el índice es el promedio ponderado por el peso de cada control (config/valoracion.json).`,
      `Anti-invención: el agente solo puede calificar salvaguardas del catálogo y citar documentos cargados; cada cita se verifica contra el texto original y las que no coinciden se descartan.${
        st.quotes != null ? ` En este análisis: ${st.quotes - st.rejectedQuotes} citas verificadas, ${st.rejectedQuotes} descartadas, ${st.downgraded} estados degradados a "Sin evidencia".` : ''
      }`,
      'Las salvaguardas sin evidencia no implican necesariamente incumplimiento: indican que la documentación provista no permite afirmarlo.',
      catalog.note && `Nota del catálogo: ${catalog.note}`,
    ]
      .filter(Boolean)
      .map((p) => `<p>${esc(p)}</p>`)
      .join(''),
  };

  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in data ? data[k] : m));
}

// ---------- impresión a PDF con el navegador instalado ----------

function findBrowser() {
  const env = process.env.CHROME_PATH;
  const candidates = [
    env,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw Object.assign(new Error('No se encontró Chrome ni Edge para generar el PDF. Configurá CHROME_PATH en .env con la ruta del navegador.'), { status: 500 });
  }
  return found;
}

export async function renderPdf(html, { footer = '' } = {}) {
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font:8px 'Segoe UI',Arial,sans-serif;color:#7d8a80;padding:0 12mm;display:flex;justify-content:space-between">
        <span>${esc(footer)}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }
}
