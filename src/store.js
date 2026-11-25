// Persistencia por espacio de trabajo (una evaluación de una organización) en SQLite.
// createStore(row) devuelve la misma API que usa el servidor; cada cambio se guarda en la fila del workspace.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';

// overrides: estados simulados por id de salvaguarda (p. ej. {"6.3": "implementado"}).
// versions: fotos del diagnóstico (análisis + simulaciones + resumen calculado) para comparar y restaurar.
// proposal: cambios propuestos por nueva evidencia, pendientes de validación humana.
export const emptyState = () => ({ documents: [], analysis: null, overrides: {}, settings: {}, versions: [], proposal: null });

const now = () => new Date().toISOString();

function normalize(raw) {
  const s = { ...emptyState(), ...(raw || {}) };
  if (s.analysis && !s.analysis.assessments) s.analysis = null;
  s.versions = (s.versions || []).filter((v) => v.summary && 'coverage' in v.summary);
  return s;
}

/** Store en memoria (tests y herramientas): misma API, sin base de datos. */
export function memoryStore(initial = emptyState()) {
  return createStore({ id: 'mem', name: 'Memoria', ig: 1, state: JSON.stringify(initial) }, { persist: false });
}

export function createStore(row, { persist = true } = {}) {
  let state = normalize(typeof row.state === 'string' ? JSON.parse(row.state) : row.state);
  const save = () => {
    if (!persist) return;
    getDb().prepare('UPDATE workspaces SET state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), now(), row.id);
  };

  return {
    id: row.id,
    name: row.name,
    ig: Number(row.ig) || 1,
    get: () => state,

    addDocument(name, text, role = 'contexto', source = 'archivo') {
      let unique = name;
      for (let i = 2; state.documents.some((d) => d.name === unique); i++) unique = `${name} (${i})`;
      // role: "contexto" (base del diagnóstico) o "evidencia" (avance de iniciativas, sin rehacer el diagnóstico).
      // source: "archivo", "texto" o "chat" (descripción escrita en el chat).
      const doc = { id: crypto.randomUUID(), name: unique, text, role, source, chars: text.length, uploadedAt: now() };
      state.documents.push(doc);
      save();
      return doc;
    },
    removeDocument(id) {
      state.documents = state.documents.filter((d) => d.id !== id);
      save();
    },
    setAnalysis(analysis) {
      state.analysis = analysis;
      save();
    },
    setOverride(id, status) {
      if (!status) delete state.overrides[id];
      else state.overrides[id] = status;
      save();
    },
    setOverrides(overrides) {
      state.overrides = { ...overrides };
      save();
    },
    addVersion(v) {
      const n = (state.versions.at(-1)?.n || 0) + 1;
      const version = { id: crypto.randomUUID(), n, createdAt: now(), ...v };
      state.versions.push(version);
      save();
      return version;
    },
    getVersion: (id) => state.versions.find((v) => v.id === id),
    removeVersion(id) {
      state.versions = state.versions.filter((v) => v.id !== id);
      save();
    },
    setProposal(p) {
      state.proposal = p;
      save();
    },
    setSetting(key, value) {
      state.settings = { ...(state.settings || {}), [key]: value };
      save();
    },
    reset() {
      state = { ...emptyState(), settings: state.settings || {} };
      save();
    },
  };
}

// ---------- workspaces ----------

export const workspaces = {
  list(userId) {
    return getDb()
      .prepare('SELECT id, name, ig, state, created_at, updated_at FROM workspaces WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId)
      .map((w) => {
        const s = JSON.parse(w.state);
        const last = (s.versions || []).at(-1)?.summary;
        return {
          id: w.id,
          name: w.name,
          ig: w.ig,
          createdAt: w.created_at,
          updatedAt: w.updated_at,
          company: s.analysis?.company?.name && s.analysis.company.name !== 'No informado' ? s.analysis.company.name : null,
          implementation: last?.implementation ?? null,
          coverage: last?.coverage ?? null,
          versions: (s.versions || []).length,
          documents: (s.documents || []).length,
        };
      });
  },
  get(userId, id) {
    return getDb().prepare('SELECT * FROM workspaces WHERE id = ? AND user_id = ?').get(id, userId) || null;
  },
  create(userId, { name, ig = 1, state = emptyState() }) {
    const id = crypto.randomUUID();
    const t = now();
    getDb()
      .prepare('INSERT INTO workspaces (id, user_id, name, ig, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, String(name).trim().slice(0, 80) || 'Nueva evaluación', [1, 2, 3].includes(Number(ig)) ? Number(ig) : 1, JSON.stringify(state), t, t);
    return this.get(userId, id);
  },
  update(userId, id, { name, ig }) {
    const w = this.get(userId, id);
    if (!w) return null;
    getDb()
      .prepare('UPDATE workspaces SET name = ?, ig = ?, updated_at = ? WHERE id = ?')
      .run(name != null ? String(name).trim().slice(0, 80) || w.name : w.name, [1, 2, 3].includes(Number(ig)) ? Number(ig) : w.ig, now(), id);
    return this.get(userId, id);
  },
  remove(userId, id) {
    getDb().prepare('DELETE FROM workspaces WHERE id = ? AND user_id = ?').run(id, userId);
  },
};

/** Si existe el estado de la versión anterior (data/state.json, un solo espacio), se importa al primer usuario. */
export function importLegacyState(userId) {
  const file = path.resolve('data/state.json');
  if (process.env.IMPORT_LEGACY === 'false' || !fs.existsSync(file)) return null;
  try {
    const s = normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!s.documents.length && !s.analysis) return null;
    delete s.settings?.model;
    const name = s.analysis?.company?.name && s.analysis.company.name !== 'No informado' ? `${s.analysis.company.name} (importado)` : 'Evaluación importada';
    const w = workspaces.create(userId, { name, ig: 1, state: s });
    fs.renameSync(file, file + '.importado');
    return w;
  } catch (e) {
    console.warn(`[import] No se pudo importar data/state.json: ${e.message}`);
    return null;
  }
}
