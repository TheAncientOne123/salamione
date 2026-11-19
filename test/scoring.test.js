import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeDashboard } from '../public/scoring.js';
import { loadCatalog } from '../src/catalog.js';
import { verifyAnalysis, quoteInText } from '../src/verify.js';
import { heuristicAnalysis, heuristicChat } from '../src/heuristic.js';

const catalog = loadCatalog();
const sample = [{ name: 'empresa-demo.md', text: fs.readFileSync('samples/empresa-demo.md', 'utf8') }];
const analyzed = () => verifyAnalysis(heuristicAnalysis(sample, catalog), sample, catalog);

test('el catálogo se lee del Markdown: 56 salvaguardas en 15 controles', () => {
  assert.equal(catalog.safeguards.length, 56);
  assert.deepEqual(catalog.controls.map((c) => c.id), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '14', '15', '17']);
  assert.equal(catalog.controls.find((c) => c.id === '14').safeguards.length, 8);
});

test('el verificador descarta ids inventados y citas que no están en los documentos', () => {
  const raw = {
    company: { name: 'Empresa Inventada SRL', sector: 'distribución mayorista de alimentos' },
    safeguards: [
      { id: '99.1', status: 'implementado', rationale: '', evidence: [] },
      { id: '6.3', status: 'implementado', rationale: '', evidence: [{ document: 'empresa-demo.md', quote: 'Todas las cuentas usan MFA desde 2023' }] },
      { id: '11.2', status: 'no_implementado', rationale: '', evidence: [{ document: 'empresa-demo.md', quote: 'No hay copias de seguridad automáticas' }] },
    ],
  };
  const v = verifyAnalysis(raw, sample, catalog);
  assert.equal(v.stats.unknownIds, 1);
  assert.equal(v.assessments['6.3'].status, 'sin_evidencia'); // cita inventada -> degradada
  assert.equal(v.assessments['6.3'].downgraded, true);
  assert.equal(v.assessments['11.2'].status, 'no_implementado');
  assert.equal(Object.keys(v.assessments).length, 56);
  assert.equal(v.company.name, 'No informado');
  assert.equal(v.company.sector, 'distribución mayorista de alimentos');
});

test('las citas toleran mayúsculas, acentos y elipsis', () => {
  const text = 'El acceso remoto se hace por VPN, sin doble factor de autenticación.';
  assert.ok(quoteInText('el acceso remoto se hace por VPN ... sin doble factor de autenticacion', text));
  assert.ok(!quoteInText('el acceso remoto usa MFA', text));
});

test('aplicar salvaguardas sube el índice; parcial rinde la mitad', () => {
  const a = analyzed();
  const d0 = computeDashboard(catalog, a, {});
  const dp = computeDashboard(catalog, a, { '11.2': 'parcial' });
  const df = computeDashboard(catalog, a, { '11.2': 'implementado' });
  assert.equal(d0.index, d0.baseIndex);
  assert.ok(dp.index > d0.index && df.index > dp.index);
  assert.equal(Math.round((df.index - d0.index) * 10), Math.round(d0.safeguards.find((s) => s.id === '11.2').gain * 10));
  const all = Object.fromEntries(catalog.safeguards.map((s) => [s.id, 'implementado']));
  assert.equal(computeDashboard(catalog, a, all).index, 100);
});

test('los pesos por control cambian el índice', () => {
  const a = analyzed();
  const heavy = { ...catalog, controls: catalog.controls.map((c) => ({ ...c, weight: c.id === '1' ? 100 : 1 })) };
  assert.notEqual(computeDashboard(heavy, a, {}).index, computeDashboard(catalog, a, {}).index);
});

test('el modo demo detecta brechas con citas verificadas', () => {
  const a = analyzed();
  assert.equal(a.stats.rejectedQuotes, 0);
  assert.equal(a.assessments['6.4'].status, 'no_implementado');
  assert.equal(a.assessments['5.4'].status, 'no_implementado');
  assert.equal(a.company.name, 'Distribuidora Andina S.A.');
  const d = computeDashboard(catalog, a, {});
  assert.match(heuristicChat([{ role: 'user', content: '¿Qué salvaguardas implemento primero?' }], d), /\+\d/);
  assert.match(heuristicChat([{ role: 'user', content: 'hola' }], null), /Subí la documentación/);
});

test('el catálogo expone nombre corto y alcance leídos del archivo', () => {
  assert.equal(catalog.shortName, 'CIS Controls v8.1, Implementation Group 1 (IG1)');
  assert.match(catalog.scope, /13, 16 y 18/);
  assert.equal(catalog.maxPerControl, 8);
});

test('la plantilla del PDF se completa sin marcadores pendientes', async () => {
  const { renderReportHtml } = await import('../src/report.js');
  const d = computeDashboard(catalog, analyzed(), { '11.2': 'implementado' });
  const html = renderReportHtml(d, { documents: sample, catalog });
  assert.doesNotMatch(html, /\{\{\w+\}\}/);
  assert.equal((html.match(/class="card ctrl"/g) || []).length, catalog.controls.length);
  assert.match(html, /Aplicado manualmente/);
});

test('comparar versiones: índice, controles y salvaguardas que cambiaron', async () => {
  const { versionSummary, compareVersions } = await import('../public/versions.js');
  const a = analyzed();
  const v1 = versionSummary(computeDashboard(catalog, a, {}));
  const v2 = versionSummary(computeDashboard(catalog, a, { '11.2': 'implementado', '6.4': 'parcial', '9.1': 'no_implementado' }));
  const c = compareVersions(v1, v2);
  assert.ok(c.index.delta > 0);
  assert.equal(c.changes.length, 3);
  assert.equal(c.improved, 2); // 11.2 y 6.4
  assert.equal(c.worsened, 1); // 9.1 parcial -> no implementado
  assert.equal(c.changes.find((x) => x.id === '11.2').applied, true);
  assert.equal(c.controls.find((x) => x.id === '11').delta, 25);
  assert.equal(c.counts.implementado.delta, 1);
  // Sin cambios: comparación vacía
  assert.equal(compareVersions(v1, v1).changes.length, 0);
});
