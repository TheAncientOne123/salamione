// Resumen ejecutivo estandarizado de UNA página (carta, vertical).
// - buildOnePagerHtml: completa la plantilla fija templates/reporte-1p.html con datos verificados.
// - renderOnePager: imprime con el navegador del sistema, achica la letra si hace falta y verifica
//   que el PDF tenga exactamente una página (si no, falla: nunca se informa un archivo que no cumple).
import fs from 'node:fs';
import path from 'node:path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { launchBrowser } from './browser.js';
import { STATUS, SEVERITY, EFFORT, pct, fmt } from '../shared/scoring.js';
import { esc } from './components.js';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

// ---------- 1. Nombre del archivo ----------

const slug = (x) => norm(x).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organizacion';

/** Resumen-ejecutivo_<organizacion>_IG<n>_<fecha>.pdf */
export function reportFileName({ company, ig = 1, date = new Date() }) {
  return `Resumen-ejecutivo_${slug(company)}_IG${ig}_${date.toISOString().slice(0, 10)}.pdf`;
}

// ---------- 2. Contenido ----------

const ORDER = ['organizacion', 'procesos', 'infraestructura', 'activos', 'identidades', 'proteccion', 'recuperacion', 'monitoreo', 'gobierno'];
const ref = (e) => (e ? `<span class="ref">[${esc(e.document)}${e.ref ? `, ${esc(e.ref)}` : ''}]</span>` : '');

function contextItems(d) {
  const out = [];
  for (const id of ORDER) {
    const dim = d.context?.dimensions?.find((x) => x.id === id);
    const f = dim?.findings?.[0];
    if (f) out.push(`<li><b>${esc(dim.name)}:</b> ${esc(clip(f.statement, 125))} ${ref(f.evidence[0])}</li>`);
    if (out.length === 6) break;
  }
  return out.length ? out.join('') : '<li>El documento no aporta información de contexto verificable.</li>';
}

function riskItems(d) {
  const items = d.risks.slice(0, 5).map((r) => {
    const sg = d.safeguards.find((s) => r.safeguards.includes(s.id) && s.evidence.length);
    return `<li><b>${esc(clip(r.title, 90))}</b><span class="tag ${r.severity}">${esc(SEVERITY[r.severity])}</span> <span class="sub">— ${esc(
      clip(r.deficiency, 115)
    )}</span> ${ref(sg?.evidence[0])}</li>`;
  });
  // Si hay menos de cinco riesgos, se completa con brechas confirmadas (nunca con no verificadas).
  for (const s of d.priorities) {
    if (items.length >= 5) break;
    if (d.risks.some((r) => r.safeguards.includes(s.id))) continue;
    items.push(`<li><b>Brecha ${esc(s.id)} · ${esc(clip(s.title, 55))}</b> <span class="sub">— ${esc(STATUS[s.status].long)}</span> ${ref(s.evidence[0])}</li>`);
  }
  return items.join('') || '<li>No se identificaron brechas confirmadas por el documento.</li>';
}

function recommendationItems(d) {
  const items = d.initiatives.slice(0, 5).map(
    (i) =>
      `<li><b>${esc(clip(i.name, 90))}</b><span class="tag ${i.type === 'quick_win' ? 'qw' : 'pr'}">${i.type === 'quick_win' ? 'Quick win' : 'Proyecto'}</span> <span class="sub">— esfuerzo ${esc(
        EFFORT[i.effort].toLowerCase()
      )}; salvaguardas ${esc(i.safeguards.join(', '))}.</span></li>`
  );
  for (const s of d.priorities) {
    if (items.length >= 5) break;
    if (d.initiatives.some((i) => i.safeguards.includes(s.id))) continue;
    items.push(`<li><b>Implementar ${esc(s.id)} · ${esc(clip(s.title, 55))}</b> <span class="sub">— cerrar la brecha confirmada.</span></li>`);
  }
  return items.join('') || '<li>Sin recomendaciones: no hay brechas confirmadas.</li>';
}

function uncertaintyItems(d) {
  const items = [...d.controls]
    .filter((c) => c.counts.no_verificado)
    .sort((a, b) => b.counts.no_verificado - a.counts.no_verificado || a.id - b.id)
    .slice(0, 3)
    .map((c) => {
      const ids = c.safeguards.filter((id) => d.safeguards.find((s) => s.id === id).status === 'no_verificado');
      return `<li><b>Control ${esc(c.id)} · ${esc(c.name)}:</b> ${ids.length} de ${c.safeguards.length} salvaguardas sin evidencia suficiente (${esc(
        ids.join(', ')
      )}). <span class="sub">Requiere evidencia documental antes de concluir; no se cuentan como incumplimiento.</span></li>`;
    });
  const missing = d.context?.dimensions?.flatMap((x) => (x.id === 'restricciones' ? [] : x.missing.map((m) => `${x.name}: ${m}`))) || [];
  for (const m of missing) {
    if (items.length >= 3) break;
    items.push(`<li>${esc(clip(m, 160))}</li>`);
  }
  return items.join('') || '<li>Sin incertidumbres relevantes: todas las salvaguardas aplicables tienen evidencia.</li>';
}

function conclusion(d, meta) {
  const worst = [...d.controls]
    .filter((c) => c.counts.no_implementado)
    .sort((a, b) => b.counts.no_implementado - a.counts.no_implementado)
    .slice(0, 3)
    .map((c) => `${c.id}. ${c.name}`);
  const first = d.initiatives.slice(0, 2).map((i) => `"${i.name}"`);
  return [
    `Con la evidencia disponible al ${meta.cutoff}, ${meta.company} presenta una implementación de ${pct(d.implementation)} sobre ${d.evaluable} salvaguardas evaluables (${d.label.label.toLowerCase()}) y una cobertura de evaluación de ${pct(d.coverage)} de las ${d.total} salvaguardas de ${d.shortName}.`,
    worst.length ? `Las brechas confirmadas se concentran en ${worst.join('; ')}.` : '',
    d.counts.no_verificado
      ? `${d.counts.no_verificado} salvaguardas no pudieron verificarse con el documento: no se cuentan como incumplimiento, pero limitan la certeza del diagnóstico.`
      : '',
    first.length ? `Se recomienda priorizar ${first.join(' y ')}.` : '',
    'Resultado documental provisional, sujeto a validación del auditor; no constituye una certificación.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildOnePagerHtml(d, meta, catalog) {
  const n = d.counts;
  const tile = (l, v, main = false) => `<div class="ind${main ? ' main' : ''}"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`;
  const order = ['implementado', 'parcial', 'no_implementado', 'no_verificado', 'no_aplicable'];
  const data = {
    titulo: esc(meta.fileName),
    css: read('templates/reporte-1p.css'),
    logo: read('web/public/logo.svg'),
    empresa: esc(meta.company),
    preparadoPor: esc(meta.preparedBy || 'SalamiOne'),
    motor: esc(d.engine),
    marco: esc(d.shortName),
    fechaCorte: esc(meta.cutoff),
    version: esc(meta.version),
    alcance: esc(meta.scope),
    emitido: esc(new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })),
    fuente: esc(clip(meta.sources.join(', '), 80)),
    contexto: contextItems(d),
    indicadores: [
      tile(`Implementación IG${d.ig}`, pct(d.implementation), true),
      tile(`Cobertura IG${d.ig}`, pct(d.coverage), true),
      ...order.map((k) => tile(STATUS[k].long, `${n[k]}`)),
    ].join(''),
    distribucion: order
      .filter((k) => n[k])
      .map((k) => `<i class="${k}" style="width:${(100 * n[k]) / d.total}%">${n[k]}</i>`)
      .join(''),
    leyenda:
      order.map((k) => `<span><i class="sq dist-${k}" style="background:${{ implementado: '#0ca30c', parcial: '#fab219', no_implementado: '#d03b3b', no_verificado: '#bfc2c8', no_aplicable: '#e7e8ea' }[k]}"></i>${esc(STATUS[k].long)}</span>`).join('') +
      `<span>· Implementación = (I + 0,5·P) / (I + P + N) · Cobertura = (I + P + N) / (${d.total} − NA)</span>`,
    riesgos: riskItems(d),
    recomendaciones: recommendationItems(d),
    incertidumbres: uncertaintyItems(d),
    conclusion: esc(conclusion(d, meta)),
    pie: esc(
      `Evaluación basada exclusivamente en ${meta.sources.join(', ')} y en el catálogo ${d.shortName} (${d.total} salvaguardas). Cada conclusión tiene una cita verificada en el documento (detalle en el Excel de ${d.total} salvaguardas). "Implementado" es una conclusión documental provisional, no una certificación. Generado con SalamiOne.`
    ),
  };
  return read('templates/reporte-1p.html').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in data ? data[k] : m));
}

// ---------- 3. Impresión con verificación de una página ----------

export async function renderOnePager(html, { startSize = 10.4 } = {}) {
  const { browser, close } = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 816, height: 1056 });
    await page.setContent(html, { waitUntil: 'load' });
    // Si el contenido no entra en la hoja, se achica la letra en pasos hasta que entre (mínimo 7 px).
    let size = startSize;
    for (;;) {
      const overflow = await page.$eval('#sheet', (el) => el.scrollHeight > el.clientHeight + 1);
      if (!overflow) break;
      size -= 0.2;
      if (size < 7) throw Object.assign(new Error('El contenido no entra en una página carta ni con la letra mínima: hay que resumirlo más.'), { status: 422 });
      await page.evaluate((px) => (document.body.style.fontSize = `${px}px`), size);
    }
    const pdf = Buffer.from(await page.pdf({ width: '8.5in', height: '11in', printBackground: true, preferCSSPageSize: true, pageRanges: '1' }));
    const { numpages } = await pdfParse(pdf);
    if (numpages !== 1) throw Object.assign(new Error(`El PDF generado tiene ${numpages} páginas en lugar de una.`), { status: 500 });
    return { pdf, pages: numpages, fontSize: Math.round(size * 10) / 10 };
  } finally {
    await close();
  }
}

export { fmt };
