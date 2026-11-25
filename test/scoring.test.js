import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeDashboard, indicators } from '../public/scoring.js';
import { loadCatalog } from '../src/catalog.js';
import { verifyAssessments, verifyContext, verifyRoadmap, verifyProposal, quoteInText, locateRef, newStats } from '../src/verify.js';
import { heuristicAnalysis, heuristicContext, heuristicRoadmap, heuristicProposal, heuristicChat } from '../src/heuristic.js';
import { versionSummary, compareVersions } from '../public/versions.js';
import { matrixCsv } from '../src/matrix.js';

const catalog = loadCatalog();
const sample = [{ name: 'empresa-demo.md', text: fs.readFileSync('samples/empresa-demo.md', 'utf8') }];
const evidence = [{ name: 'avance-iniciativas.md', text: fs.readFileSync('samples/avance-iniciativas.md', 'utf8') }];
const assessed = () => verifyAssessments(heuristicAnalysis(sample, catalog), sample, catalog);
const fullAnalysis = () => {
  const assessments = assessed();
  return { assessments, ...verifyRoadmap(heuristicRoadmap(assessments, catalog), assessments, catalog), context: verifyContext(heuristicContext(sample), sample) };
};

test('catálogo CIS v8.1: IG1 = 56 en 15 controles, IG2 = 130 e IG3 = 153 en 18 controles', () => {
  assert.equal(catalog.safeguards.length, 56);
  assert.deepEqual(catalog.controls.map((c) => c.id), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '14', '15', '17']);
  assert.match(catalog.scope, /13, 16 y 18/);
  const ig2 = loadCatalog(2);
  const ig3 = loadCatalog(3);
  assert.equal(ig2.safeguards.length, 130);
  assert.equal(ig3.safeguards.length, 153);
  assert.equal(ig3.controls.length, 18);
  assert.equal(ig2.shortName, 'CIS Controls v8.1 IG2');
  assert.ok(ig2.safeguards.every((s) => s.ig <= 2));
  assert.ok(ig3.safeguards.some((s) => s.id === '18.5' && s.ig === 3));
  // Las 56 de IG1 son las mismas en los tres alcances.
  assert.deepEqual(ig3.safeguards.filter((s) => s.ig === 1).map((s) => s.id), catalog.safeguards.map((s) => s.id));
});

test('evaluación por lotes: ningún lote supera el tamaño y se cubren todas las salvaguardas', async () => {
  const { batches } = await import('../src/agent.js');
  const ig3 = loadCatalog(3);
  const b = batches(ig3, 40);
  assert.ok(b.length >= 4);
  assert.ok(b.every((x) => x.length <= 40));
  assert.deepEqual(b.flat(), ig3.safeguards.map((s) => s.id));
});

test('IG2: el motor demo evalúa las 130 y el dashboard cuenta sobre 130', () => {
  const ig2 = loadCatalog(2);
  const a = verifyAssessments(heuristicAnalysis(sample, ig2), sample, ig2);
  assert.equal(Object.keys(a).length, 130);
  const d = computeDashboard(ig2, { assessments: a }, {});
  assert.equal(d.total, 130);
  assert.equal(d.ig, 2);
});

test('indicadores de la consigna: implementación y cobertura', () => {
  const st = [...Array(10).fill('implementado'), ...Array(4).fill('parcial'), ...Array(6).fill('no_implementado'), ...Array(30).fill('no_verificado'), ...Array(6).fill('no_aplicable')];
  const r = indicators(st);
  assert.equal(r.implementation, 60); // (10 + 2) / 20
  assert.equal(r.coverage, 40); // 20 / (56 - 6)
  assert.equal(indicators(Array(56).fill('no_verificado')).implementation, null); // "No determinable"
});

test('R8: "no verificado" no cuenta como incumplimiento', () => {
  const a = { assessments: { '1.1': { status: 'implementado', evidence: [{}] } } };
  const d = computeDashboard(catalog, a, {});
  assert.equal(d.implementation, 100); // 1 evaluable, implementada; las 55 no verificadas no bajan el indicador
  assert.ok(d.coverage < 2);
});

test('el verificador descarta ids inventados y citas falsas, y degrada a no verificado', () => {
  const raw = {
    safeguards: [
      { id: '99.1', status: 'implementado', evidence: [] },
      { id: '6.3', status: 'implementado', applicability: 'aplica', evidence: [{ document: 'empresa-demo.md', quote: 'Todas las cuentas usan MFA desde 2023' }] },
      { id: '11.2', status: 'no_implementado', applicability: 'aplica', evidence: [{ document: 'empresa-demo.md', quote: 'No hay copias de seguridad automáticas' }] },
      { id: '3.6', status: 'no_aplicable', applicability: 'no_aplica', evidence: [] },
    ],
  };
  const stats = newStats();
  const a = verifyAssessments(raw, sample, catalog, stats);
  assert.equal(stats.unknownIds, 1);
  assert.equal(a['6.3'].status, 'no_verificado');
  assert.equal(a['3.6'].status, 'no_verificado'); // "no aplicable" sin justificación documentada
  assert.equal(a['11.2'].status, 'no_implementado');
  assert.equal(a['11.2'].evidence[0].ref, '§ 2. Tecnología y seguridad de la información');
  assert.equal(Object.keys(a).length, 56);
});

test('referencias: página en PDF y sección en Markdown', () => {
  const pdfText = '[[Página 1]]\nPortada\n[[Página 2]]\nNo existe doble factor de autenticación.';
  assert.equal(locateRef('No existe doble factor de autenticación', pdfText), 'p. 2');
  assert.ok(quoteInText('no existe DOBLE factor ... autenticacion', pdfText));
});

test('modo demo: evaluación conservadora, no aplicable justificado y contexto con citas', () => {
  const a = assessed();
  assert.equal(a['6.4'].status, 'no_implementado');
  assert.equal(a['10.3'].status, 'no_aplicable');
  assert.equal(a['4.4'].status, 'parcial'); // R4: tener firewall no prueba la salvaguarda completa
  const ctx = verifyContext(heuristicContext(sample), sample);
  assert.equal(ctx.dimensions.length, 10);
  assert.ok(ctx.dimensions.every((d) => d.findings.every((f) => f.evidence.length)));
});

test('riesgos y roadmap: cinco, vinculados a brechas reales y tipos coherentes', () => {
  const an = fullAnalysis();
  assert.equal(an.risks.length, 5);
  assert.equal(an.initiatives.length, 5);
  for (const r of an.risks) assert.ok(r.safeguards.every((id) => ['no_implementado', 'parcial', 'no_verificado'].includes(an.assessments[id].status)));
  for (const i of an.initiatives) assert.ok(!(i.effort === 'alto' && i.type === 'quick_win'));
});

test('nueva evidencia: propone solo cambios con cita, y el estado inicial lo pone el sistema', () => {
  const an = fullAnalysis();
  const p = verifyProposal(heuristicProposal(evidence, an.assessments, catalog), evidence, an.assessments, catalog);
  const byId = Object.fromEntries(p.changes.map((c) => [c.id, c]));
  assert.equal(byId['11.2'].from, 'no_implementado');
  assert.equal(byId['11.2'].proposed, 'implementado');
  assert.equal(byId['6.4'].proposed, 'implementado');
  assert.equal(byId['6.5'].proposed, 'parcial'); // piloto al 40 %
  assert.equal(byId['14.1'].proposed, 'parcial'); // 60 % del personal
  assert.ok(p.changes.every((c) => c.evidence.length && c.evidence[0].ref));
  assert.equal(p.initiatives.length, 3);
});

test('versiones: la comparación muestra indicadores, salvaguardas y riesgos', () => {
  const an = fullAnalysis();
  const v1 = versionSummary(computeDashboard(catalog, an, {}));
  const updated = { ...an, assessments: { ...an.assessments, '11.2': { ...an.assessments['11.2'], status: 'implementado' } } };
  const v2 = versionSummary(computeDashboard(catalog, updated, {}));
  const c = compareVersions(v1, v2);
  assert.ok(c.implementation.delta > 0);
  assert.equal(c.changes.length, 1);
  assert.equal(c.improved, 1);
  assert.equal(c.risks.length, 5);
  assert.ok(c.risks.some((r) => r.changed));
  assert.equal(c.verdict.key, 'mejora');
  // Retroceso: la salvaguarda implementada vuelve a no implementada.
  const back = compareVersions(v2, v1);
  assert.equal(back.verdict.key, 'retroceso');
  assert.equal(back.verdict.label, 'Empeoró');
  assert.equal(compareVersions(v1, v1).verdict.key, 'sin_cambios');
});

test('Excel: el dashboard y la comparación se exportan como .xlsx con sus hojas', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const { dashboardXlsx, comparisonXlsx } = await import('../src/xlsx.js');
  const an = fullAnalysis();
  const d = computeDashboard(catalog, an, {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await dashboardXlsx(d, { label: 'v1', documents: sample }));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumen', 'Controles', 'Salvaguardas', 'Riesgos', 'Roadmap', 'Contexto']);
  assert.equal(wb.getWorksheet('Salvaguardas').rowCount, 57); // encabezado + 56
  const v = versionSummary(d);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(await comparisonXlsx({ label: 'A' }, { label: 'B' }, compareVersions(v, v)));
  assert.equal(wb2.worksheets[0].name, 'Veredicto');
});

test('seguridad: contraseñas con scrypt y API keys cifradas', async () => {
  const { hashPassword, verifyPassword, encrypt, decrypt, maskKey } = await import('../src/security.js');
  const h = hashPassword('una-clave-larga');
  assert.ok(verifyPassword('una-clave-larga', h));
  assert.ok(!verifyPassword('otra', h));
  const blob = encrypt('sk-ant-123456');
  assert.doesNotMatch(blob, /sk-ant/);
  assert.equal(decrypt(blob), 'sk-ant-123456');
  assert.equal(maskKey('sk-ant-123456'), '•••• 3456');
});

test('proveedores de IA: configuración, JSON tolerante y errores legibles', async () => {
  const { createAI, describeError, resolveConfig } = await import('../src/ai/index.js');
  const { parseJsonLoose } = await import('../src/ai/json.js');
  assert.equal(createAI(null), null);
  assert.equal(createAI({ provider: 'anthropic', model: 'claude-opus-5-5' }), null); // sin key
  assert.equal(createAI({ provider: 'anthropic', apiKey: 'x' }).model, 'claude-opus-5-5');
  assert.equal(resolveConfig({ provider: 'ollama' }).baseURL, 'http://localhost:11434/v1');
  assert.ok(createAI({ provider: 'ollama', model: 'llama3.1' })); // local, sin key
  assert.deepEqual(parseJsonLoose('Aquí va:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(describeError({ status: 401 }, { provider: 'gemini', model: 'x' }).fallback, true);
  assert.match(describeError({ message: 'fetch failed' }, { provider: 'ollama' }).message, /Ollama/);
});

test('matriz CSV: 56 filas, separador ; e indicadores', () => {
  const csv = matrixCsv(computeDashboard(catalog, fullAnalysis(), {}), 'v1');
  const lines = csv.split('\r\n');
  assert.ok(lines[0].startsWith('﻿Versión;ID CIS;'));
  assert.equal(lines.filter((l) => /^v1;\d+\.\d+;/.test(l)).length, 56);
  assert.match(csv, /Cobertura de evaluación;/);
});

test('la plantilla del reporte se completa sin marcadores pendientes', async () => {
  const { renderReportHtml } = await import('../src/report.js');
  const d = computeDashboard(catalog, fullAnalysis(), {});
  const html = renderReportHtml(d, { documents: sample, catalog });
  assert.doesNotMatch(html, /\{\{\w+\}\}/);
  assert.equal((html.match(/class="card ctrl"/g) || []).length, catalog.controls.length);
});

test('prueba preliminar: el agente explica objetivo, criterios y qué hace sin información', () => {
  const r = heuristicChat([{ role: 'user', content: 'Explicá cuál es tu objetivo y qué harás cuando no tengas suficiente información' }], null, catalog);
  assert.match(r, /56 salvaguardas/);
  assert.match(heuristicChat([{ role: 'user', content: '¿cuál es tu objetivo?' }], null, loadCatalog(3)), /153 salvaguardas/);
  assert.match(r, /No verificado/);
});

test('resumen ejecutivo de una página: nombre de archivo y plantilla completa', async () => {
  const { reportFileName, buildOnePagerHtml } = await import('../src/onepager.js');
  assert.equal(reportFileName({ company: 'Distribuidora Andina S.A.', ig: 2, date: new Date('2026-11-25T10:00:00Z') }), 'Resumen-ejecutivo_distribuidora-andina-s-a_IG2_2026-11-25.pdf');
  const d = computeDashboard(catalog, fullAnalysis(), {});
  const html = buildOnePagerHtml(d, { company: 'Demo', preparedBy: 'Analista', cutoff: 'hoy', version: 'v1', scope: '56', sources: ['empresa-demo.md'], fileName: 'x.pdf' }, catalog);
  assert.doesNotMatch(html, /{{w+}}/);
  assert.match(html, /CIS Controls v8.1 IG1/);
});

test('PDF de una página desde el chat: contenido del agente → carta, 1 página', async () => {
  const { buildSummaryHtml, miniMarkdown, safePdfName, createSummaryPdf } = await import('../src/pdfsummary.js');
  assert.equal(safePdfName('ACME_IG1_RESUMEN_V1.pdf'), 'ACME_IG1_RESUMEN_V1.pdf');
  assert.equal(safePdfName('Reporte final: versión 1'), 'Reporte_final_version_1.pdf');
  assert.match(miniMarkdown('- uno\n- **dos**\n\n| A | B |\n|---|---|\n| 1 | 2 |'), /<ul><li>uno<\/li><li><b>dos<\/b><\/li><\/ul><table>/);
  const doc = {
    nombre_archivo: 'PRUEBA_UNA_PAGINA',
    titulo: 'Reporte ejecutivo',
    subtitulo: 'Diagnóstico inicial',
    datos: [{ etiqueta: 'Empresa', valor: 'Ejemplo' }],
    secciones: Array.from({ length: 7 }, (_, i) => ({ titulo: `Sección ${i + 1}`, contenido: '- punto uno\n- punto dos\nTexto de la sección.', destacada: i === 6 })),
    pie: '',
  };
  assert.doesNotMatch(buildSummaryHtml(doc), /\{\{\w+\}\}/);
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
  const { file, pages, pdf } = await createSummaryPdf(doc, dir);
  assert.equal(file, 'PRUEBA_UNA_PAGINA.pdf');
  assert.equal(pages, 1);
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 612 792\]/); // carta
  fs.rmSync(dir, { recursive: true, force: true });
});
