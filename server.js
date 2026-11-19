import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { store } from './src/store.js';
import { extractText, SUPPORTED } from './src/extract.js';
import { loadCatalog } from './src/catalog.js';
import { verifyAnalysis } from './src/verify.js';
import { renderReportHtml, renderPdf } from './src/report.js';
import { analyze, chat, hasLLM, modelName, llmStatus, AGENT_NAME, MODELS, getModel, setModel } from './src/agent.js';
import { computeDashboard, APPLICABLE, STATUS, fmt } from './public/scoring.js';
import { versionSummary } from './public/versions.js';

const catalog = loadCatalog();

// Modelo elegido en la página (persistido); si ya no está permitido, se usa el de .env.
try {
  if (store.get().settings?.model) setModel(store.get().settings.model);
} catch {
  store.setSetting('model', null);
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 20 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err.status && err.status < 500 ? err.message : err);
    res.status(err.status || 500).json({ error: err.message || 'Error interno' });
  });

const fail = (status, message) => Object.assign(new Error(message), { status });

const currentDashboard = () => {
  const { analysis, overrides } = store.get();
  return analysis ? computeDashboard(catalog, analysis, overrides) : null;
};

function snapshot() {
  const { documents, analysis, overrides } = store.get();
  return {
    agent: { name: AGENT_NAME, llm: hasLLM(), model: modelName(), selectedModel: getModel(), models: MODELS, error: llmStatus(), supported: SUPPORTED },
    catalog,
    documents: documents.map(({ text, ...d }) => ({ ...d, preview: text.slice(0, 280) })),
    // Si se cargaron documentos después del último análisis, el dashboard está desactualizado.
    stale: !!analysis && documents.some((d) => d.uploadedAt > analysis.generatedAt),
    overrides,
    analysis,
    dashboard: currentDashboard(),
    // Las versiones viajan sin la copia completa del análisis (solo el resumen para comparar).
    versions: store.get().versions.map(({ analysis: _a, overrides: _o, ...v }) => v),
  };
}

/** Guarda una versión con el estado actual (análisis + controles aplicados + resumen calculado). */
function saveVersion(label, reason = 'manual') {
  const { analysis, overrides, documents } = store.get();
  const d = currentDashboard();
  if (!d) throw fail(400, 'Todavía no hay análisis para versionar.');
  return store.addVersion({
    label: String(label || '').trim().slice(0, 80) || (reason === 'analisis' ? 'Análisis de la documentación' : 'Versión guardada'),
    reason,
    engine: analysis.engine,
    documents: documents.map((x) => x.name),
    summary: versionSummary(d),
    analysis,
    overrides: { ...overrides },
  });
}

// ---------------- Operaciones (las usan la API y las herramientas del chat) ----------------

async function runAnalysis() {
  const { documents } = store.get();
  if (!documents.length) throw fail(400, 'Subí al menos un documento antes de analizar.');
  const { raw, engine, truncated, warning } = await analyze(documents, catalog);
  const verified = verifyAnalysis(raw, documents, catalog);
  store.setAnalysis({
    ...verified,
    engine,
    truncated: !!truncated,
    warning: warning || null,
    generatedAt: new Date().toISOString(),
  });
  saveVersion(`Análisis · ${documents.length} documento${documents.length === 1 ? '' : 's'}`, 'analisis');
  const s = verified.stats;
  console.log(`[análisis] ${engine}: ${s.quotes - s.rejectedQuotes}/${s.quotes} citas verificadas, ${s.downgraded} degradadas, ${s.unknownIds} ids desconocidos`);
  return currentDashboard();
}

function setSafeguard(id, status) {
  if (!store.get().analysis) throw fail(400, 'Primero hay que analizar la documentación.');
  const sg = catalog.safeguards.find((s) => s.id === id);
  if (!sg) throw fail(404, `La salvaguarda ${id} no existe en el catálogo.`);
  if (status !== 'documentado' && !APPLICABLE.includes(status)) throw fail(400, `Estado inválido. Usá: ${APPLICABLE.join(', ')} o documentado.`);
  const before = currentDashboard().index;
  store.setOverride(id, status === 'documentado' ? null : status);
  const d = currentDashboard();
  return { sg, before, after: d.index, current: d.safeguards.find((s) => s.id === id).status };
}

// ---------------- Fuente de verdad ----------------

app.get('/api/state', (req, res) => res.json(snapshot()));

app.post('/api/documents', upload.array('files'), wrap(async (req, res) => {
  if (!req.files?.length) throw fail(400, 'No se recibieron archivos.');
  const errors = [];
  const added = [];
  for (const f of req.files) {
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    try {
      added.push(store.addDocument(name, await extractText(f.buffer, name)).name);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  res.json({ ...snapshot(), added, errors });
}));

app.post('/api/documents/text', wrap(async (req, res) => {
  const { name, text } = req.body || {};
  if (!text?.trim()) throw fail(400, 'El texto está vacío.');
  store.addDocument((name || 'Nota').trim().slice(0, 120), text.trim());
  res.json(snapshot());
}));

app.delete('/api/documents/:id', (req, res) => {
  store.removeDocument(req.params.id);
  res.json(snapshot());
});

// ---------------- Análisis, salvaguardas y reporte ----------------

app.post('/api/analyze', wrap(async (req, res) => {
  await runAnalysis();
  res.json(snapshot());
}));

app.put('/api/safeguards/:id', wrap(async (req, res) => {
  setSafeguard(req.params.id, req.body?.status);
  res.json(snapshot());
}));

function reportHtml() {
  const d = currentDashboard();
  if (!d) throw fail(400, 'Todavía no hay análisis para exportar.');
  return { d, html: renderReportHtml(d, { documents: store.get().documents, catalog }) };
}

// Vista previa HTML de la plantilla (útil para ajustar templates/reporte.html).
app.get('/api/report.html', wrap(async (req, res) => {
  res.type('html').send(reportHtml().html);
}));

app.get('/api/report.pdf', wrap(async (req, res) => {
  const { d, html } = reportHtml();
  const org = d.company.name === 'No informado' ? 'organizacion' : d.company.name;
  const slug = org.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
  const pdf = await renderPdf(html, { footer: `Cyber Cactus · ${org} · Confidencial` });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Informe-${slug}-${new Date().toISOString().slice(0, 10)}.pdf"`);
  res.end(Buffer.from(pdf));
}));

// ---------------- Versiones ----------------

app.post('/api/versions', wrap(async (req, res) => {
  const v = saveVersion(req.body?.label, 'manual');
  res.json({ ...snapshot(), created: v.id });
}));

// Restaurar: vuelve al diagnóstico y a los controles aplicados de esa versión (no toca los documentos).
app.post('/api/versions/:id/restore', wrap(async (req, res) => {
  const v = store.getVersion(req.params.id);
  if (!v) throw fail(404, 'Versión inexistente.');
  store.setAnalysis(v.analysis);
  store.setOverrides(v.overrides || {});
  res.json(snapshot());
}));

app.delete('/api/versions/:id', (req, res) => {
  store.removeVersion(req.params.id);
  res.json(snapshot());
});

// ---------------- Configuración ----------------

app.put('/api/settings', wrap(async (req, res) => {
  const { model } = req.body || {};
  if (model) {
    setModel(model);
    store.setSetting('model', model);
  }
  res.json(snapshot());
}));

// ---------------- Chat con Cyber Cactus ----------------

const chatTools = {
  async actualizar_salvaguarda({ id, estado }) {
    const { sg, before, after, current } = setSafeguard(String(id), estado);
    return {
      ok: true,
      id: sg.id,
      salvaguarda: sg.title,
      estadoActual: current,
      indiceAntes: before,
      indiceDespues: after,
      action: {
        text: `${sg.id} · ${sg.title} → ${estado === 'documentado' ? `según documentación (${STATUS[current].label})` : STATUS[estado].label}`,
        before,
        after,
      },
    };
  },
  async guardar_version({ nombre }) {
    const v = saveVersion(nombre, 'manual');
    return {
      ok: true,
      version: v.n,
      nombre: v.label,
      indice: v.summary.index,
      action: { text: `Versión v${v.n} guardada: ${v.label}`, before: null, after: v.summary.index },
    };
  },
  async analizar_documentacion() {
    const before = currentDashboard()?.index ?? null;
    const d = await runAnalysis();
    return {
      ok: true,
      indice: d.index,
      conteo: d.counts,
      prioridades: d.priorities.slice(0, 8).map((s) => ({ id: s.id, titulo: s.title, mejora: s.gain })),
      action: { text: `Documentación analizada contra CIS IG1: índice ${fmt(d.index)}/100`, before, after: d.index },
    };
  },
};

app.post('/api/chat', wrap(async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) throw fail(400, 'Mensaje vacío.');
  const { reply, actions } = await chat(messages, {
    documents: store.get().documents,
    catalog,
    dashboard: currentDashboard,
    tools: chatTools,
  });
  res.json({ reply, actions, state: actions.length ? snapshot() : undefined });
}));

app.post('/api/reset', (req, res) => {
  store.reset();
  res.json(snapshot());
});

app.use((err, req, res, next) => {
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`${AGENT_NAME} en http://localhost:${PORT}`);
  console.log(`Catálogo: ${catalog.source} — ${catalog.safeguards.length} salvaguardas, ${catalog.controls.length} controles`);
  console.log(hasLLM() ? `Motor: OpenAI (${modelName()})` : 'Motor: heurístico — configurá OPENAI_API_KEY en .env para usar ChatGPT');
});
