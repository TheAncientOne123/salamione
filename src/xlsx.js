// Exportación a Excel (.xlsx): dashboard completo y comparación antes/después.
// Hojas del dashboard: Resumen · Controles · Salvaguardas · Riesgos · Roadmap · Contexto.
import ExcelJS from 'exceljs';
import { STATUS, APPLICABILITY, SEVERITY, EFFORT, INIT_TYPE, RISK_STATE, INIT_STATE, pct } from '../shared/scoring.js';

const BRAND = 'FF8C1D40';
const DARK = 'FF1E2126';
const FILL = {
  implementado: 'FFD5F0D5',
  parcial: 'FFFDEBC4',
  no_implementado: 'FFF6D2D2',
  no_verificado: 'FFE7E8EA',
  no_aplicable: 'FFF3F3F4',
  mejora: 'FFD5F0D5',
  retroceso: 'FFF6D2D2',
  neutral: 'FFF3F3F4',
};
const p1 = (n) => (n == null ? null : Math.round(n * 10) / 1000); // 62.5 → 0.625 (formato %)

function newBook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SalamiOne';
  wb.created = new Date();
  return wb;
}

function sheet(wb, name, columns) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.h, key: c.k, width: c.w || 14, style: { alignment: { vertical: 'top', wrapText: !!c.wrap }, ...(c.fmt ? { numFmt: c.fmt } : {}) } }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 22;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

const fillCell = (cell, key) => FILL[key] && (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[key] } });

function title(ws, text, sub) {
  ws.getCell('A1').value = text;
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: DARK } };
  if (sub) {
    ws.getCell('A2').value = sub;
    ws.getCell('A2').font = { color: { argb: 'FF4B4F57' } };
  }
}

export async function dashboardXlsx(d, { label = 'actual', documents = [], analysis = null } = {}) {
  const wb = newBook();

  // ---- Resumen ----
  const r = wb.addWorksheet('Resumen');
  r.columns = [{ width: 38 }, { width: 22 }, { width: 70 }];
  title(r, `Dashboard CIS · ${d.company.name === 'No informado' ? 'Organización' : d.company.name}`, `${d.shortName} · versión ${label} · generado ${new Date().toLocaleString('es')}`);
  const rows = [
    [],
    ['Indicador', 'Valor', 'Detalle'],
    ['Implementación', p1(d.implementation), `Sobre ${d.evaluable} salvaguardas evaluables: (I + 0,5·P) / (I + P + N)`],
    ['Cobertura de evaluación', p1(d.coverage), `(I + P + N) / (${d.total} − No aplicables)`],
    ['Nivel', d.label.label, ''],
    ['Total de salvaguardas', d.total, d.shortName],
    ...Object.keys(STATUS).map((k) => [STATUS[k].long, d.counts[k], d.counts[k] !== d.baseCounts[k] ? `según evidencia: ${d.baseCounts[k]}` : '']),
    ['Riesgos prioritarios', d.risks.length, `${d.risks.filter((x) => x.state === 'vigente').length} vigentes`],
    ['Iniciativas del roadmap', d.initiatives.length, `${d.initiatives.filter((i) => i.type === 'quick_win').length} quick wins`],
    [],
    ['Organización', d.company.name, d.company.sector !== 'No informado' ? `Sector: ${d.company.sector}` : ''],
    ['Motor de evaluación', d.engine, ''],
    ['Evaluación inicial', d.generatedAt ? new Date(d.generatedAt).toLocaleString('es') : '', d.updatedAt ? `Actualizada: ${new Date(d.updatedAt).toLocaleString('es')}` : ''],
    ['Documentos', documents.map((x) => x.name).join(', ') || (analysis?.documents || []).join(', '), ''],
    [],
    ['Resumen ejecutivo', '', ''],
    ...d.summary.map((s) => ['', '', s]),
  ];
  rows.forEach((row) => r.addRow(row));
  r.getRow(4).font = { bold: true };
  r.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  r.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  r.getCell('B5').numFmt = '0.0%';
  r.getCell('B6').numFmt = '0.0%';
  r.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

  // ---- Controles ----
  const c = sheet(wb, 'Controles', [
    { h: 'Control', k: 'id', w: 9 },
    { h: 'Nombre', k: 'name', w: 44, wrap: true },
    { h: 'Salvaguardas', k: 'n', w: 13 },
    { h: 'Implementación', k: 'impl', w: 15, fmt: '0.0%' },
    { h: 'Cobertura', k: 'cov', w: 12, fmt: '0.0%' },
    { h: 'Nivel', k: 'label', w: 14 },
    ...Object.keys(STATUS).map((k) => ({ h: STATUS[k].label, k, w: 13 })),
  ]);
  for (const x of d.controls) {
    const row = c.addRow({ id: x.id, name: x.name, n: x.safeguards.length, impl: p1(x.implementation), cov: p1(x.coverage), label: x.label.label, ...x.counts });
    fillCell(row.getCell('impl'), x.implementation == null ? 'no_verificado' : x.implementation >= 80 ? 'implementado' : x.implementation >= 40 ? 'parcial' : 'no_implementado');
  }

  // ---- Salvaguardas ----
  const s = sheet(wb, 'Salvaguardas', [
    { h: 'ID', k: 'id', w: 7 },
    { h: 'IG', k: 'ig', w: 6 },
    { h: 'Control', k: 'control', w: 30, wrap: true },
    { h: 'Salvaguarda', k: 'title', w: 42, wrap: true },
    { h: 'Aplicabilidad', k: 'app', w: 14 },
    { h: 'Estado', k: 'status', w: 22 },
    { h: 'Valor', k: 'value', w: 7 },
    { h: 'Justificación', k: 'why', w: 50, wrap: true },
    { h: 'Evidencia (documento, página/sección y cita)', k: 'ev', w: 60, wrap: true },
    { h: 'Observaciones e historial', k: 'obs', w: 45, wrap: true },
    { h: 'Estado según evidencia', k: 'doc', w: 22 },
    { h: 'Simulado', k: 'sim', w: 10 },
  ]);
  for (const x of d.safeguards) {
    const row = s.addRow({
      id: x.id,
      ig: `IG${x.ig || 1}`,
      control: `${x.controlId}. ${x.controlName}`,
      title: x.title,
      app: APPLICABILITY[x.applicability],
      status: STATUS[x.status].long,
      value: x.value,
      why: x.rationale,
      ev: x.evidence.map((e) => `${e.document}${e.ref ? ` (${e.ref})` : ''}: "${e.quote}"`).join('\n') || 'Sin evidencia documental',
      obs: [x.observations, ...(x.history || []).map((h) => `${new Date(h.at).toLocaleDateString('es')}: ${STATUS[h.from]?.long || h.from} → ${STATUS[h.to]?.long || h.to} (${h.documents.join(', ')})`)].filter(Boolean).join('\n'),
      doc: STATUS[x.documented].long,
      sim: x.overridden ? 'Sí' : 'No',
    });
    fillCell(row.getCell('status'), x.status);
  }

  // ---- Riesgos ----
  const rk = sheet(wb, 'Riesgos', [
    { h: 'ID', k: 'id', w: 6 },
    { h: 'Riesgo', k: 'title', w: 34, wrap: true },
    { h: 'Descripción', k: 'desc', w: 44, wrap: true },
    { h: 'Activo / proceso', k: 'asset', w: 28, wrap: true },
    { h: 'Deficiencia', k: 'def', w: 40, wrap: true },
    { h: 'Consecuencia', k: 'cons', w: 36, wrap: true },
    { h: 'Severidad', k: 'sev', w: 11 },
    { h: 'Estado', k: 'state', w: 11 },
    { h: 'Salvaguardas', k: 'sg', w: 18, wrap: true },
  ]);
  for (const x of d.risks) {
    const row = rk.addRow({ id: x.id, title: x.title, desc: x.description, asset: x.asset, def: x.deficiency, cons: x.consequence, sev: SEVERITY[x.severity], state: RISK_STATE[x.state], sg: x.safeguards.join(', ') });
    fillCell(row.getCell('state'), { vigente: 'no_implementado', reducido: 'parcial', mitigado: 'implementado' }[x.state]);
  }

  // ---- Roadmap ----
  const rm = sheet(wb, 'Roadmap', [
    { h: 'Prioridad', k: 'p', w: 10 },
    { h: 'Iniciativa', k: 'name', w: 36, wrap: true },
    { h: 'Descripción', k: 'desc', w: 46, wrap: true },
    { h: 'Riesgos', k: 'risks', w: 10 },
    { h: 'Salvaguardas', k: 'sg', w: 18, wrap: true },
    { h: 'Beneficio', k: 'ben', w: 40, wrap: true },
    { h: 'Esfuerzo', k: 'eff', w: 10 },
    { h: 'Tipo', k: 'type', w: 20 },
    { h: 'Avance', k: 'prog', w: 10, fmt: '0%' },
    { h: 'Estado', k: 'state', w: 13 },
  ]);
  for (const i of d.initiatives) {
    rm.addRow({ p: i.priority, name: i.name, desc: i.description, risks: i.risks.join(', '), sg: i.safeguards.join(', '), ben: i.benefit, eff: EFFORT[i.effort], type: INIT_TYPE[i.type], prog: i.progress.pct / 100, state: INIT_STATE[i.progress.state] });
  }

  // ---- Contexto ----
  const cx = sheet(wb, 'Contexto', [
    { h: 'Dimensión', k: 'dim', w: 18 },
    { h: 'Tipo', k: 'type', w: 16 },
    { h: 'Afirmación o información faltante', k: 'text', w: 80, wrap: true },
    { h: 'Fuente', k: 'src', w: 34, wrap: true },
  ]);
  for (const dim of d.context?.dimensions || []) {
    for (const f of dim.findings) cx.addRow({ dim: dim.name, type: 'Hallazgo', text: f.statement, src: f.evidence.map((e) => `${e.document}${e.ref ? `, ${e.ref}` : ''}`).join('; ') });
    for (const m of dim.missing) cx.addRow({ dim: dim.name, type: 'Falta información', text: m, src: '' });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function comparisonXlsx(A, B, c) {
  const wb = newBook();
  const r = wb.addWorksheet('Veredicto');
  r.columns = [{ width: 34 }, { width: 22 }, { width: 22 }, { width: 16 }];
  title(r, `Comparación antes / después · ${c.verdict.label}`, c.verdict.text);
  r.addRow([]);
  const head = r.addRow(['Indicador', `A · ${A.label}`, `B · ${B.label}`, 'Variación']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  const dl = (x) => (x == null ? null : Math.round(x * 10) / 10);
  r.addRow(['Implementación (%)', dl(c.implementation.a), dl(c.implementation.b), dl(c.implementation.delta)]);
  r.addRow(['Cobertura (%)', dl(c.coverage.a), dl(c.coverage.b), dl(c.coverage.delta)]);
  for (const [k, v] of Object.entries(STATUS)) {
    const x = c.counts[k] || { a: 0, b: 0, delta: 0 };
    r.addRow([v.long, x.a, x.b, x.delta]);
  }
  r.addRow(['Salvaguardas que mejoraron', '', '', c.improved]);
  r.addRow(['Salvaguardas que retrocedieron', '', '', c.worsened]);
  const v = r.getCell('A1');
  v.font = { bold: true, size: 16, color: { argb: c.verdict.key === 'mejora' ? 'FF1D7A3E' : c.verdict.key === 'retroceso' ? 'FFB02A2A' : DARK } };

  const ct = sheet(wb, 'Controles', [
    { h: 'Control', k: 'id', w: 9 },
    { h: 'Nombre', k: 'name', w: 44 },
    { h: 'A (%)', k: 'a', w: 10 },
    { h: 'B (%)', k: 'b', w: 10 },
    { h: 'Δ (pts)', k: 'd', w: 10 },
  ]);
  for (const x of c.controls) {
    const row = ct.addRow({ id: x.id, name: x.name, a: dl(x.a), b: dl(x.b), d: dl(x.delta) });
    if (x.delta) fillCell(row.getCell('d'), x.delta > 0 ? 'mejora' : 'retroceso');
  }

  const sg = sheet(wb, 'Salvaguardas', [
    { h: 'ID', k: 'id', w: 7 },
    { h: 'Salvaguarda', k: 'title', w: 50, wrap: true },
    { h: 'Estado A', k: 'from', w: 22 },
    { h: 'Estado B', k: 'to', w: 22 },
    { h: 'Resultado', k: 'dir', w: 12 },
    { h: 'Simulado', k: 'sim', w: 10 },
  ]);
  for (const x of c.changes) {
    const row = sg.addRow({ id: x.id, title: x.title, from: x.from ? STATUS[x.from]?.long : '—', to: x.to ? STATUS[x.to]?.long : '—', dir: x.direction, sim: x.applied ? 'Sí' : 'No' });
    fillCell(row.getCell('dir'), x.direction);
  }

  const rk = sheet(wb, 'Riesgos', [
    { h: 'ID', k: 'id', w: 6 },
    { h: 'Riesgo', k: 'title', w: 44, wrap: true },
    { h: 'Severidad', k: 'sev', w: 11 },
    { h: 'Estado A', k: 'from', w: 12 },
    { h: 'Estado B', k: 'to', w: 12 },
    { h: 'Resultado', k: 'res', w: 12 },
  ]);
  for (const x of c.risks) rk.addRow({ id: x.id, title: x.title, sev: SEVERITY[x.severity], from: RISK_STATE[x.from], to: x.to ? RISK_STATE[x.to] : '—', res: x.changed ? 'Cambió' : 'Permanece' });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export { pct };
