import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { openDb } from './src/db.js';
import { authRoutes, requireAuth, sameOrigin, publicUser, getUser, setUserField } from './src/auth.js';
import { createStore, workspaces } from './src/store.js';
import { encrypt, decrypt, maskKey } from './src/security.js';
import { extractText, SUPPORTED } from './src/extract.js';
import { loadCatalog } from './src/catalog.js';
import { verifyContext, verifyAssessments, verifyCompany, verifyRoadmap, verifyProposal, newStats } from './src/verify.js';
import { renderReportHtml, renderPdf, renderComparisonHtml } from './src/report.js';
import { matrixCsv } from './src/matrix.js';
import { dashboardXlsx, comparisonXlsx } from './src/xlsx.js';
import { reportFileName, buildOnePagerHtml, renderOnePager } from './src/onepager.js';
import { createSummaryPdf } from './src/pdfsummary.js';
import { analyzeContext, analyzeSafeguards, analyzeRoadmap, proposeUpdate, chat, AGENT_NAME } from './src/agent.js';
import { PROVIDERS, createAI, listModels, describeError, resolveConfig } from './src/ai/index.js';
import { computeDashboard, APPLICABLE, STATUS, pct } from './public/scoring.js';
import { versionSummary, compareVersions } from './public/versions.js';

openDb();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 20 } });
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '5mb' }));

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error(err.status && err.status < 500 ? err.message : err);
    res.status(err.status || 500).json({ error: err.message || 'Error interno' });
  });
const fail = (status, message) => Object.assign(new Error(message), { status });

// ---------------- Páginas ----------------

const page = (file) => (req, res) => res.sendFile(path.resolve('public', file));
app.get('/', page('index.html'));
app.get(['/login', '/registro'], page('login.html'));
app.get('/app', requireAuth, page('app.html'));
app.get('/app.html', (req, res) => res.redirect('/app'));
app.use(express.static('public', { index: false }));

// ---------------- Autenticación ----------------

app.use('/api', sameOrigin);
authRoutes(app, wrap);
app.use('/api', requireAuth);

// ---------------- Contexto por solicitud: usuario, espacio de trabajo, catálogo e IA ----------------

const aiErrors = new Map(); // userId → { message, at }

function readAiConfig(user) {
  try {
    return JSON.parse(user.ai_config || 'null');
  } catch {
    return null;
  }
}

/** Configuración de IA del usuario; si no configuró ninguna, la del servidor (si existe en .env). */
function aiConfigFor(user) {
  const cfg = readAiConfig(user);
  if (cfg?.provider === 'none') return null;
  if (cfg?.provider) return { ...cfg, apiKey: decrypt(cfg.apiKey), source: 'usuario' };
  if (process.env.SERVER_AI !== 'false') {
    if (process.env.OPENAI_API_KEY) return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, baseURL: process.env.OPENAI_BASE_URL, source: 'servidor' };
    if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL, source: 'servidor' };
  }
  return null;
}

function context(req) {
  const user = req.user;
  let row = user.active_workspace && workspaces.get(user.id, user.active_workspace);
  if (!row) {
    row = workspaces.list(user.id)[0] ? workspaces.get(user.id, workspaces.list(user.id)[0].id) : workspaces.create(user.id, { name: 'Mi primera evaluación', ig: 1 });
    setUserField(user.id, 'active_workspace', row.id);
  }
  const store = createStore(row);
  const catalog = loadCatalog(row.ig);
  const ai = createAI(aiConfigFor(user));
  const onError = (message) => (message ? aiErrors.set(user.id, { message, at: new Date().toISOString() }) : aiErrors.delete(user.id));
  return { user, row, store, catalog, ai, onError, exportDir: path.resolve('data/exports', row.id) };
}

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  try {
    req.ctx = context(req);
    next();
  } catch (e) {
    next(e);
  }
});

const dashboardOf = (ctx) => {
  const { analysis, overrides } = ctx.store.get();
  return analysis ? computeDashboard(ctx.catalog, analysis, overrides) : null;
};

function snapshot(ctx) {
  const { documents, analysis, overrides, proposal, versions } = ctx.store.get();
  const err = aiErrors.get(ctx.user.id) || null;
  const cfg = aiConfigFor(ctx.user);
  return {
    user: publicUser(getUser(ctx.user.id)),
    workspace: { id: ctx.row.id, name: ctx.row.name, ig: ctx.row.ig },
    workspaces: workspaces.list(ctx.user.id),
    agent: {
      name: AGENT_NAME,
      ai: ctx.ai ? { connected: true, label: ctx.ai.label, provider: ctx.ai.provider, model: ctx.ai.model, source: cfg?.source } : { connected: false },
      error: err,
      supported: SUPPORTED,
    },
    catalog: ctx.catalog,
    documents: documents.map(({ text, ...d }) => ({ ...d, role: d.role || 'contexto', preview: text.replace(/\[\[Página \d+\]\]\n?/g, '').slice(0, 280) })),
    stale: !!analysis && documents.some((d) => (d.role || 'contexto') === 'contexto' && d.uploadedAt > analysis.generatedAt),
    overrides,
    analysis,
    proposal,
    dashboard: dashboardOf(ctx),
    versions: versions.map(({ analysis: _a, overrides: _o, ...v }) => v),
  };
}

function saveVersion(ctx, label, reason = 'manual') {
  const { analysis, overrides, documents } = ctx.store.get();
  const d = dashboardOf(ctx);
  if (!d) throw fail(400, 'Todavía no hay análisis para versionar.');
  return ctx.store.addVersion({
    label: String(label || '').trim().slice(0, 80) || 'Versión guardada',
    reason,
    ig: ctx.catalog.ig,
    engine: analysis.engine,
    documents: documents.map((x) => x.name),
    summary: versionSummary(d),
    analysis,
    overrides: { ...overrides },
  });
}

// ---------------- Evaluación inicial ----------------

async function runAnalysis(ctx) {
  const docs = ctx.store.get().documents.filter((d) => (d.role || 'contexto') === 'contexto');
  if (!docs.length) throw fail(400, 'Sube al menos un documento de contexto (o describe la organización en el chat) antes de analizar.');
  const { ai, catalog, onError } = ctx;
  const stats = newStats();

  // R1: primero el contexto…
  const cx = await analyzeContext(ai, docs, catalog, onError);
  const contextCard = verifyContext(cx.raw, docs, stats);
  const company = verifyCompany(cx.raw.company, docs);
  // …si el proveedor falló en el contexto, el resto también usa el motor demo (coherencia de la evaluación)…
  const aiForRest = cx.warning ? null : ai;
  const ev = await analyzeSafeguards(aiForRest, docs, catalog, contextCard, onError);
  const assessments = verifyAssessments(ev.raw, docs, catalog, stats);
  // …y por último riesgos y roadmap sobre la matriz verificada.
  const rm = await analyzeRoadmap(ev.warning ? null : aiForRest, assessments, catalog, contextCard, onError);
  const { risks, initiatives } = verifyRoadmap(rm.raw, assessments, catalog);
  const warning = cx.warning || ev.warning || rm.warning || null;

  ctx.store.setAnalysis({
    company,
    context: contextCard,
    assessments,
    risks,
    initiatives,
    stats,
    ig: catalog.ig,
    engine: warning && !cx.warning ? `${ev.engine} (parcial)` : ev.engine,
    truncated: !!ev.truncated,
    warning: cx.warning || ev.warning || null,
    documents: docs.map((d) => d.name),
    generatedAt: new Date().toISOString(),
    updates: [],
  });
  ctx.store.setOverrides({});
  ctx.store.setProposal(null);
  saveVersion(ctx, `Evaluación inicial · ${docs.map((d) => d.name).join(', ').slice(0, 60)}`, 'analisis');
  console.log(`[análisis ${ctx.row.id.slice(0, 8)}] ${ev.engine}: ${stats.quotes - stats.rejectedQuotes}/${stats.quotes} citas verificadas, ${stats.downgraded} degradadas`);
  return dashboardOf(ctx);
}

/** Toma los mensajes del usuario en el chat como documento de contexto (las citas se verifican contra ellos). */
function chatDocument(ctx, messages, title) {
  const user = (messages || []).filter((m) => m.role === 'user' && String(m.content).trim().length >= 20).map((m) => String(m.content).trim());
  if (!user.length || user.join(' ').length < 120) {
    throw fail(400, 'Hace falta una descripción más completa de la organización: activos, cuentas y accesos, MFA, respaldos, parches, antimalware, registros, capacitación, incidentes y proveedores.');
  }
  const text = user.map((t, i) => `## Mensaje ${i + 1} del usuario\n${t}`).join('\n\n');
  const name = String(title || 'Descripción en el chat').trim().slice(0, 100);
  // Reemplaza una descripción anterior del chat para no duplicar contexto.
  for (const d of ctx.store.get().documents.filter((x) => x.source === 'chat')) ctx.store.removeDocument(d.id);
  return ctx.store.addDocument(name, text, 'contexto', 'chat');
}

// ---------------- Nueva evidencia, propuesta y validación ----------------

async function processEvidence(ctx, newDocs) {
  const { analysis } = ctx.store.get();
  if (!analysis) throw fail(400, 'Primero hace falta la evaluación inicial (sube el documento de contexto).');
  const d = dashboardOf(ctx);
  const previous = {
    contexto: analysis.context,
    matriz: d.safeguards.map((s) => ({ id: s.id, estado: s.documented, justificacion: s.rationale })),
    riesgos: d.risks.map((r) => ({ id: r.id, titulo: r.title, salvaguardas: r.safeguards })),
    roadmap: d.initiatives.map((i) => ({ id: i.id, nombre: i.name, salvaguardas: i.safeguards })),
  };
  const stats = newStats();
  const out = await proposeUpdate(ctx.ai, newDocs, analysis.assessments, ctx.catalog, previous, ctx.onError);
  const verified = verifyProposal(out.raw, newDocs, analysis.assessments, ctx.catalog, stats);
  for (const i of verified.initiatives) i.risks = d.risks.filter((r) => r.safeguards.some((id) => i.safeguards.includes(id))).map((r) => r.id);
  ctx.store.setProposal({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    documents: newDocs.map((x) => x.name),
    engine: out.engine,
    warning: out.warning || null,
    status: 'abierta',
    stats,
    ...verified,
  });
}

function decide(ctx, id, decision) {
  const p = ctx.store.get().proposal;
  if (!p || p.status !== 'abierta') throw fail(400, 'No hay una propuesta abierta.');
  const c = p.changes.find((x) => x.id === id);
  if (!c) throw fail(404, `La salvaguarda ${id} no está en la propuesta.`);
  if (c.decision === 'sin_cambio') throw fail(400, 'Ese cambio no tiene evidencia suficiente: se mantiene el estado.');
  if (!['aprobado', 'rechazado', 'pendiente'].includes(decision)) throw fail(400, 'Decisión inválida (aprobado | rechazado | pendiente).');
  c.decision = decision;
  ctx.store.setProposal(p);
}

/** Aplica SOLO los cambios aprobados (R11), conserva el historial y guarda la versión actualizada. */
function applyProposal(ctx) {
  const { analysis, proposal, overrides } = ctx.store.get();
  if (!proposal || proposal.status !== 'abierta') throw fail(400, 'No hay una propuesta abierta.');
  const approved = proposal.changes.filter((c) => c.decision === 'aprobado');
  if (!approved.length) throw fail(400, 'No hay cambios aprobados para aplicar.');
  const before = dashboardOf(ctx);
  const at = new Date().toISOString();
  const assessments = { ...analysis.assessments };
  for (const c of approved) {
    const old = assessments[c.id] || { status: 'no_verificado', evidence: [] };
    assessments[c.id] = {
      ...old,
      status: c.proposed,
      applicability: c.proposed === 'no_aplicable' ? 'no_aplica' : c.proposed === 'no_verificado' ? 'por_determinar' : 'aplica',
      evidence: [...c.evidence, ...(old.evidence || [])].slice(0, 4),
      rationale: c.justification,
      observations: c.pending || '',
      downgraded: false,
      history: [...(old.history || []), { at, from: old.status, to: c.proposed, documents: proposal.documents, justification: c.justification }],
    };
    delete overrides[c.id];
  }
  ctx.store.setOverrides(overrides);
  ctx.store.setAnalysis({
    ...analysis,
    assessments,
    updatedAt: at,
    updates: [
      ...(analysis.updates || []),
      {
        at,
        documents: proposal.documents,
        approved: approved.map((c) => c.id),
        rejected: proposal.changes.filter((c) => c.decision === 'rechazado').map((c) => c.id),
        pending: proposal.changes.filter((c) => c.decision === 'pendiente').map((c) => c.id),
        changes: proposal.changes,
        initiatives: proposal.initiatives,
      },
    ],
  });
  ctx.store.setProposal({ ...proposal, status: 'aplicada', appliedAt: at });
  const v = saveVersion(ctx, `Evaluación actualizada · ${proposal.documents.join(', ').slice(0, 60)}`, 'actualizacion');
  return { before, after: dashboardOf(ctx), version: v };
}

function setSafeguard(ctx, id, status) {
  if (!ctx.store.get().analysis) throw fail(400, 'Primero hay que analizar la documentación.');
  const sg = ctx.catalog.safeguards.find((s) => s.id === id);
  if (!sg) throw fail(404, `La salvaguarda ${id} no existe en ${ctx.catalog.shortName}.`);
  if (status !== 'documentado' && !APPLICABLE.includes(status)) throw fail(400, `Estado inválido. Usa: ${APPLICABLE.join(', ')} o documentado.`);
  const before = dashboardOf(ctx).implementation;
  ctx.store.setOverride(id, status === 'documentado' ? null : status);
  const d = dashboardOf(ctx);
  return { sg, before, after: d.implementation, current: d.safeguards.find((s) => s.id === id).status };
}

// ---------------- Rutas: estado, espacios de trabajo y cuenta ----------------

app.get('/api/state', (req, res) => res.json(snapshot(req.ctx)));

app.post('/api/workspaces', wrap(async (req, res) => {
  const { name, ig } = req.body || {};
  const w = workspaces.create(req.user.id, { name: name || 'Nueva evaluación', ig });
  setUserField(req.user.id, 'active_workspace', w.id);
  req.user.active_workspace = w.id;
  res.json(snapshot(context(req)));
}));

app.put('/api/workspaces/:id', wrap(async (req, res) => {
  const w = workspaces.update(req.user.id, req.params.id, req.body || {});
  if (!w) throw fail(404, 'Evaluación inexistente.');
  res.json(snapshot(context(req)));
}));

app.post('/api/workspaces/:id/activate', wrap(async (req, res) => {
  if (!workspaces.get(req.user.id, req.params.id)) throw fail(404, 'Evaluación inexistente.');
  setUserField(req.user.id, 'active_workspace', req.params.id);
  req.user.active_workspace = req.params.id;
  res.json(snapshot(context(req)));
}));

app.delete('/api/workspaces/:id', wrap(async (req, res) => {
  workspaces.remove(req.user.id, req.params.id);
  fs.rmSync(path.resolve('data/exports', path.basename(req.params.id)), { recursive: true, force: true });
  if (req.user.active_workspace === req.params.id) {
    setUserField(req.user.id, 'active_workspace', null);
    req.user.active_workspace = null;
  }
  res.json(snapshot(context(req)));
}));

app.put('/api/me', wrap(async (req, res) => {
  const { onboarded, name } = req.body || {};
  if (onboarded !== undefined) setUserField(req.user.id, 'onboarded', onboarded ? 1 : 0);
  if (name) setUserField(req.user.id, 'name', String(name).trim().slice(0, 80));
  req.user = getUser(req.user.id);
  res.json(snapshot(context(req)));
}));

// ---------------- Rutas: configuración de IA (cada usuario conecta su modelo) ----------------

function aiSettings(user) {
  const cfg = readAiConfig(user);
  const server = !cfg?.provider && aiConfigFor(user);
  return {
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, { label: p.label, needsKey: p.needsKey, defaultModel: p.defaultModel, baseURL: p.baseURL || '', keyUrl: p.keyUrl || null, hint: p.hint }])),
    config: cfg?.provider ? { provider: cfg.provider, model: cfg.model || '', baseURL: cfg.baseURL || '', key: maskKey(decrypt(cfg.apiKey)) } : null,
    server: server ? { provider: server.provider, model: resolveConfig(server).model } : null,
  };
}

app.get('/api/me/ai', (req, res) => res.json(aiSettings(req.user)));

/** Mezcla lo enviado con lo guardado (la key no viaja de vuelta: si no se envía, se conserva la guardada). */
function mergeAi(user, body) {
  const prev = readAiConfig(user) || {};
  const provider = String(body.provider || '');
  if (provider === 'none') return { provider: 'none' };
  if (!PROVIDERS[provider]) throw fail(400, 'Elige un proveedor válido.');
  const apiKey = body.apiKey ? String(body.apiKey).trim() : prev.provider === provider ? decrypt(prev.apiKey) : null;
  return { provider, model: String(body.model || '').trim(), baseURL: String(body.baseURL || '').trim(), apiKey };
}

app.put('/api/me/ai', wrap(async (req, res) => {
  const body = req.body || {};
  if (body.provider === 'server') {
    setUserField(req.user.id, 'ai_config', null);
  } else {
    const cfg = mergeAi(req.user, body);
    if (cfg.provider !== 'none' && PROVIDERS[cfg.provider].needsKey && !cfg.apiKey) throw fail(400, `${PROVIDERS[cfg.provider].label} necesita una API key.`);
    if ((cfg.provider === 'compatible') && !cfg.baseURL) throw fail(400, 'Indica la URL base del servidor compatible (termina en /v1).');
    if (cfg.provider === 'compatible' && !cfg.model) throw fail(400, 'Indica el nombre del modelo.');
    setUserField(req.user.id, 'ai_config', JSON.stringify({ ...cfg, apiKey: encrypt(cfg.apiKey) }));
  }
  aiErrors.delete(req.user.id);
  req.user = getUser(req.user.id);
  res.json({ ...aiSettings(req.user), state: snapshot(context(req)) });
}));

app.post('/api/me/ai/models', wrap(async (req, res) => {
  const cfg = mergeAi(req.user, req.body || {});
  try {
    res.json({ models: await listModels(cfg) });
  } catch (e) {
    throw fail(400, describeError(e, { provider: cfg.provider, model: cfg.model }).message);
  }
}));

app.post('/api/me/ai/test', wrap(async (req, res) => {
  const cfg = mergeAi(req.user, req.body || {});
  const ai = createAI(cfg);
  if (!ai) throw fail(400, 'Faltan datos: proveedor, modelo o API key.');
  const t0 = Date.now();
  try {
    const out = await ai.structured({
      system: 'Eres un verificador de conexión.',
      user: 'Responde con ok=true y el número de salvaguardas de CIS Controls v8.1 IG1.',
      name: 'prueba',
      schema: { type: 'object', additionalProperties: false, required: ['ok', 'salvaguardas_ig1'], properties: { ok: { type: 'boolean' }, salvaguardas_ig1: { type: 'integer' } } },
    });
    res.json({ ok: true, ms: Date.now() - t0, label: ai.label, answer: out });
  } catch (e) {
    throw fail(400, describeError(e, ai).message);
  }
}));

// ---------------- Rutas: documentos, caso de ejemplo y análisis ----------------

async function addFiles(ctx, files, role) {
  const errors = [];
  const added = [];
  for (const f of files) {
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    try {
      added.push(ctx.store.addDocument(name, await extractText(f.buffer, name), role));
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { added, errors };
}

app.post('/api/documents', upload.array('files'), wrap(async (req, res) => {
  if (!req.files?.length) throw fail(400, 'No se recibieron archivos.');
  const { added, errors } = await addFiles(req.ctx, req.files, 'contexto');
  res.json({ ...snapshot(req.ctx), added: added.map((d) => d.name), errors });
}));

app.post('/api/documents/text', wrap(async (req, res) => {
  const { name, text, role } = req.body || {};
  if (!text?.trim()) throw fail(400, 'El texto está vacío.');
  const doc = req.ctx.store.addDocument((name || 'Nota').trim().slice(0, 120), text.trim(), role === 'evidencia' ? 'evidencia' : 'contexto', 'texto');
  if (doc.role === 'evidencia') await processEvidence(req.ctx, [doc]);
  res.json(snapshot(req.ctx));
}));

app.delete('/api/documents/:id', (req, res) => {
  req.ctx.store.removeDocument(req.params.id);
  res.json(snapshot(req.ctx));
});

// Caso de ejemplo para el tutorial: contexto (PDF 1) y avance de iniciativas (PDF 2).
const SAMPLES = { contexto: 'samples/PDF1-contexto-empresarial.pdf', evidencia: 'samples/PDF2-avance-iniciativas.pdf' };
app.post('/api/sample/:role', wrap(async (req, res) => {
  const role = req.params.role === 'evidencia' ? 'evidencia' : 'contexto';
  const file = path.resolve(SAMPLES[role]);
  const doc = req.ctx.store.addDocument(path.basename(file), await extractText(fs.readFileSync(file), file), role);
  if (role === 'evidencia') await processEvidence(req.ctx, [doc]);
  res.json({ ...snapshot(req.ctx), added: [doc.name] });
}));

app.post('/api/analyze', wrap(async (req, res) => {
  await runAnalysis(req.ctx);
  res.json(snapshot(req.ctx));
}));

app.post('/api/evaluate-chat', wrap(async (req, res) => {
  const { messages, title } = req.body || {};
  chatDocument(req.ctx, messages, title);
  await runAnalysis(req.ctx);
  res.json(snapshot(req.ctx));
}));

app.put('/api/safeguards/:id', wrap(async (req, res) => {
  setSafeguard(req.ctx, req.params.id, req.body?.status);
  res.json(snapshot(req.ctx));
}));

// ---------------- Rutas: nueva evidencia ----------------

app.post('/api/evidence', upload.array('files'), wrap(async (req, res) => {
  if (!req.files?.length) throw fail(400, 'No se recibieron archivos.');
  if (!req.ctx.store.get().analysis) throw fail(400, 'Primero hace falta la evaluación inicial (sube el documento de contexto).');
  const { added, errors } = await addFiles(req.ctx, req.files, 'evidencia');
  if (added.length) await processEvidence(req.ctx, added);
  res.json({ ...snapshot(req.ctx), added: added.map((d) => d.name), errors });
}));

app.put('/api/proposal/changes/:id', wrap(async (req, res) => {
  decide(req.ctx, req.params.id, req.body?.decision);
  res.json(snapshot(req.ctx));
}));

app.post('/api/proposal/apply', wrap(async (req, res) => {
  const r = applyProposal(req.ctx);
  res.json({ ...snapshot(req.ctx), applied: { version: r.version.n, before: r.before.implementation, after: r.after.implementation } });
}));

app.delete('/api/proposal', (req, res) => {
  req.ctx.store.setProposal(null);
  res.json(snapshot(req.ctx));
});

// ---------------- Exportaciones ----------------

/** Dashboard de una versión ("current" o vacío = estado actual; "inicial"; número o id de versión). */
function versionRef(ctx, key) {
  const { versions, analysis } = ctx.store.get();
  if (!key || key === 'current' || key === 'actual') {
    const d = dashboardOf(ctx);
    if (!d) throw fail(400, 'Todavía no hay análisis para exportar.');
    return { d, label: 'Estado actual', short: 'actual' };
  }
  let v;
  if (key === 'inicial') v = [...versions].reverse().find((x) => x.reason === 'analisis' && x.analysis.generatedAt === analysis?.generatedAt) || versions.find((x) => x.reason === 'analisis');
  else v = versions.find((x) => x.id === key || String(x.n) === String(key).replace(/^v/i, ''));
  if (!v) throw fail(404, `No existe la versión ${key}.`);
  const cat = loadCatalog(v.ig || ctx.catalog.ig);
  return { d: computeDashboard(cat, v.analysis, v.overrides || {}), label: `v${v.n} · ${v.label}`, short: `v${v.n}`, version: v };
}

const slugOf = (d) => (d.company.name === 'No informado' ? 'organizacion' : d.company.name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
const today = () => new Date().toISOString().slice(0, 10);
const attachment = (res, type, name) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
};

function dashboardHtml(ctx, ref) {
  const { versions, documents, analysis } = ctx.store.get();
  const an = ref.version ? ref.version.analysis : analysis;
  const initial = versions.find((v) => v.reason === 'analisis' && v.analysis.generatedAt === an.generatedAt);
  return renderReportHtml(ref.d, {
    documents: ref.version ? (ref.version.documents || []).map((name) => ({ name, role: 'contexto' })) : documents,
    catalog: loadCatalog(ref.d.ig),
    analysis: an,
    initial: initial ? computeDashboard(loadCatalog(initial.ig || ref.d.ig), initial.analysis, initial.overrides || {}) : null,
  });
}

app.get(['/api/export/dashboard.html', '/api/report.html'], wrap(async (req, res) => {
  res.type('html').send(dashboardHtml(req.ctx, versionRef(req.ctx, req.query.version)));
}));

app.get(['/api/export/dashboard.pdf', '/api/report.pdf'], wrap(async (req, res) => {
  const ref = versionRef(req.ctx, req.query.version);
  const pdf = await renderPdf(dashboardHtml(req.ctx, ref), { footer: `SalamiOne · ${ref.d.company.name === 'No informado' ? 'Organización' : ref.d.company.name} · ${ref.d.shortName} · Confidencial`, maxPages: 6 });
  attachment(res, 'application/pdf', `Dashboard-${slugOf(ref.d)}-IG${ref.d.ig}-${ref.short}-${today()}.pdf`);
  res.end(Buffer.from(pdf));
}));

app.get('/api/export/dashboard.xlsx', wrap(async (req, res) => {
  const ref = versionRef(req.ctx, req.query.version);
  const buf = await dashboardXlsx(ref.d, { label: ref.label, documents: ref.version ? [] : req.ctx.store.get().documents, analysis: ref.version?.analysis || req.ctx.store.get().analysis });
  attachment(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `Dashboard-${slugOf(ref.d)}-IG${ref.d.ig}-${ref.short}-${today()}.xlsx`);
  res.end(buf);
}));

app.get('/api/matrix.csv', wrap(async (req, res) => {
  const ref = versionRef(req.ctx, req.query.version);
  attachment(res, 'text/csv; charset=utf-8', `Matriz-CIS-IG${ref.d.ig}-${slugOf(ref.d)}-${ref.short}.csv`);
  res.send(matrixCsv(ref.d, ref.short));
}));

/** Resumen ejecutivo estándar de una página de la versión pedida. */
async function generateOnePager(ctx, { version } = {}) {
  const ref = versionRef(ctx, version);
  const d = ref.d;
  const an = ref.version ? ref.version.analysis : ctx.store.get().analysis;
  const company = d.company.name !== 'No informado' ? d.company.name : ctx.row.name;
  const meta = {
    company,
    preparedBy: `${ctx.user.name} · SalamiOne`,
    cutoff: new Date().toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }),
    version: ref.version ? ref.label : d.updatedAt ? 'Evaluación actualizada (estado actual)' : 'Evaluación inicial (estado actual)',
    scope: `${d.total} salvaguardas ${d.shortName}`,
    sources: [...new Set([...(an.documents || []), ...(an.updates || []).flatMap((u) => u.documents)])],
  };
  meta.fileName = reportFileName({ company, ig: d.ig });
  const html = buildOnePagerHtml(d, meta, loadCatalog(d.ig));
  const { pdf, pages } = await renderOnePager(html);
  fs.mkdirSync(ctx.exportDir, { recursive: true });
  fs.writeFileSync(path.join(ctx.exportDir, meta.fileName), pdf);
  return { file: meta.fileName, url: `/api/exports/${encodeURIComponent(meta.fileName)}`, pages, pdf, d };
}

app.post(['/api/export/summary', '/api/report-1p'], wrap(async (req, res) => {
  const r = await generateOnePager(req.ctx, req.body || {});
  res.json({ ...snapshot(req.ctx), report: { file: r.file, url: r.url } });
}));

app.get('/api/export/summary.pdf', wrap(async (req, res) => {
  const r = await generateOnePager(req.ctx, { version: req.query.version });
  attachment(res, 'application/pdf', r.file);
  res.end(r.pdf);
}));

function comparison(ctx, a, b) {
  const A = versionRef(ctx, a || 'inicial');
  const B = versionRef(ctx, b || 'current');
  return { A, B, c: compareVersions(versionSummary(A.d), versionSummary(B.d)) };
}

app.get('/api/export/compare.json', wrap(async (req, res) => {
  const { A, B, c } = comparison(req.ctx, req.query.a, req.query.b);
  res.json({ a: A.label, b: B.label, ...c });
}));

app.get('/api/export/compare.pdf', wrap(async (req, res) => {
  const { A, B, c } = comparison(req.ctx, req.query.a, req.query.b);
  const html = renderComparisonHtml(A, B, c, { company: B.d.company.name === 'No informado' ? req.ctx.row.name : B.d.company.name, shortName: B.d.shortName });
  const pdf = await renderPdf(html, { footer: `SalamiOne · Comparación ${A.short} → ${B.short}`, maxPages: 4 });
  attachment(res, 'application/pdf', `Comparacion-${slugOf(B.d)}-${A.short}-vs-${B.short}-${today()}.pdf`);
  res.end(Buffer.from(pdf));
}));

app.get('/api/export/compare.xlsx', wrap(async (req, res) => {
  const { A, B, c } = comparison(req.ctx, req.query.a, req.query.b);
  attachment(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `Comparacion-${slugOf(B.d)}-${A.short}-vs-${B.short}-${today()}.xlsx`);
  res.end(await comparisonXlsx(A, B, c));
}));

app.get('/api/exports/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(req.ctx.exportDir, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'El archivo no existe.' });
  res.download(full, file);
});

// ---------------- Rutas: versiones ----------------

app.post('/api/versions', wrap(async (req, res) => {
  const v = saveVersion(req.ctx, req.body?.label, 'manual');
  res.json({ ...snapshot(req.ctx), created: v.id });
}));

app.post('/api/versions/:id/restore', wrap(async (req, res) => {
  const v = req.ctx.store.getVersion(req.params.id);
  if (!v) throw fail(404, 'Versión inexistente.');
  req.ctx.store.setAnalysis(v.analysis);
  req.ctx.store.setOverrides(v.overrides || {});
  req.ctx.store.setProposal(null);
  res.json(snapshot(req.ctx));
}));

app.delete('/api/versions/:id', (req, res) => {
  req.ctx.store.removeVersion(req.params.id);
  res.json(snapshot(req.ctx));
});

// ---------------- Chat ----------------

function chatToolsFor(ctx, messages) {
  const link = (text, href, download) => ({ text, href, download });
  const needAnalysis = () => {
    if (!ctx.store.get().analysis) throw new Error('Todavía no hay una evaluación: primero carga documentos o describe la organización.');
  };
  return {
    async actualizar_salvaguarda({ id, estado }) {
      const { sg, before, after, current } = setSafeguard(ctx, String(id), estado);
      return {
        ok: true,
        id: sg.id,
        salvaguarda: sg.title,
        estadoActual: current,
        implementacionAntes: before,
        implementacionDespues: after,
        action: { text: `${sg.id} · ${sg.title} → ${estado === 'documentado' ? `según evidencia (${STATUS[current].label})` : `${STATUS[estado].label} (simulado)`}`, before, after },
      };
    },
    async guardar_version({ nombre }) {
      const v = saveVersion(ctx, nombre, 'manual');
      return { ok: true, version: v.n, nombre: v.label, action: { text: `Versión v${v.n} guardada: ${v.label}`, before: null, after: v.summary.implementation } };
    },
    async crear_pdf_una_pagina(args) {
      try {
        const { file, pdf, pages } = await createSummaryPdf(args, ctx.exportDir);
        const url = `/api/exports/${encodeURIComponent(file)}`;
        return { ok: true, archivo: file, paginas: pages, formato: 'carta, vertical', tamanoKB: Math.round(pdf.length / 1024), action: link(`PDF de una página: ${file}`, url, file) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    async analizar_documentacion() {
      const before = dashboardOf(ctx)?.implementation ?? null;
      const d = await runAnalysis(ctx);
      return { ok: true, implementacion: d.implementation, cobertura: d.coverage, conteo: d.counts, action: { text: `Evaluación: implementación ${pct(d.implementation)}, cobertura ${pct(d.coverage)}`, before, after: d.implementation } };
    },
    async evaluar_desde_chat({ titulo }) {
      const doc = chatDocument(ctx, messages, titulo);
      const d = await runAnalysis(ctx);
      return {
        ok: true,
        documento: doc.name,
        implementacion: d.implementation,
        cobertura: d.coverage,
        conteo: d.counts,
        riesgos: d.risks.map((r) => r.title),
        action: { text: `Dashboard generado desde el chat (${d.shortName}): implementación ${pct(d.implementation)}, cobertura ${pct(d.coverage)}`, before: null, after: d.implementation },
      };
    },
    async exportar_dashboard({ formato }) {
      needAnalysis();
      const d = dashboardOf(ctx);
      const excel = formato === 'excel';
      const href = excel ? '/api/export/dashboard.xlsx' : '/api/export/dashboard.pdf';
      return { ok: true, formato, enlace: href, action: link(`Dashboard en ${excel ? 'Excel' : 'PDF'} · ${d.shortName}`, href, '') };
    },
    async generar_resumen_ejecutivo() {
      needAnalysis();
      const r = await generateOnePager(ctx);
      return { ok: true, archivo: r.file, paginas: r.pages, action: link(`Resumen ejecutivo de una página: ${r.file}`, r.url, r.file) };
    },
    async comparar_versiones({ version_a, version_b }) {
      needAnalysis();
      const norm = (x, def) => (!x || /inicial/i.test(x) ? def : /actual|current/i.test(x) ? 'current' : String(x).replace(/^v/i, ''));
      const { A, B, c } = comparison(ctx, norm(version_a, 'inicial'), norm(version_b, 'current'));
      const q = `a=${encodeURIComponent(norm(version_a, 'inicial'))}&b=${encodeURIComponent(norm(version_b, 'current'))}`;
      return {
        ok: true,
        a: A.label,
        b: B.label,
        veredicto: c.verdict,
        implementacion: c.implementation,
        cobertura: c.coverage,
        mejoraron: c.changes.filter((x) => x.direction === 'mejora').map((x) => `${x.id} ${x.from}→${x.to}`),
        retrocedieron: c.changes.filter((x) => x.direction === 'retroceso').map((x) => `${x.id} ${x.from}→${x.to}`),
        riesgos: c.risks,
        action: { text: `Comparación ${A.short} → ${B.short}: ${c.verdict.label}`, href: `/api/export/compare.pdf?${q}`, download: '', extra: { href: `/api/export/compare.xlsx?${q}`, label: 'Excel' } },
      };
    },
  };
}

app.post('/api/chat', wrap(async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) throw fail(400, 'Mensaje vacío.');
  const ctx = req.ctx;
  const { reply, actions } = await chat(messages, {
    ai: ctx.ai,
    documents: ctx.store.get().documents,
    catalog: ctx.catalog,
    dashboard: () => dashboardOf(ctx),
    proposal: () => ctx.store.get().proposal,
    versions: ctx.store.get().versions,
    tools: chatToolsFor(ctx, messages),
    onError: ctx.onError,
  });
  res.json({ reply, actions, state: snapshot(ctx) });
}));

app.post('/api/reset', (req, res) => {
  req.ctx.store.reset();
  fs.rmSync(req.ctx.exportDir, { recursive: true, force: true });
  res.json(snapshot(req.ctx));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err.status && err.status < 500 ? err.message : err);
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 400).json({ error: err.message });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  const c3 = loadCatalog(3);
  console.log(`${AGENT_NAME} en http://localhost:${PORT}`);
  console.log(`Catálogo: ${c3.source} — ${c3.safeguards.length} salvaguardas (IG1 ${loadCatalog(1).safeguards.length} · IG2 ${loadCatalog(2).safeguards.length} · IG3 ${c3.safeguards.length})`);
  const srv = process.env.OPENAI_API_KEY ? 'OpenAI' : process.env.ANTHROPIC_API_KEY ? 'Anthropic' : null;
  console.log(srv && process.env.SERVER_AI !== 'false' ? `IA del servidor: ${srv} (los usuarios pueden conectar la suya)` : 'Sin IA del servidor: cada usuario conecta su modelo o usa el motor demo.');
});
