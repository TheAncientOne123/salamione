// Persistencia simple en un archivo JSON (un espacio de trabajo por instalación).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve('data');
const FILE = path.join(DATA_DIR, 'state.json');

// overrides: estados aplicados por el usuario o el chat, por id de salvaguarda (p. ej. {"6.3": "implementado"}).
// versions: fotos del diagnóstico (análisis + controles aplicados + resumen calculado) para comparar y restaurar.
const empty = () => ({ documents: [], analysis: null, overrides: {}, settings: {}, versions: [] });

let state = load();

function load() {
  try {
    const s = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    // Estados guardados con el modelo anterior (riesgos inventados) se descartan.
    if (s.analysis && !s.analysis.assessments) s.analysis = null;
    delete s.applied;
    return s;
  } catch {
    return empty();
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

export const store = {
  get: () => state,

  addDocument(name, text) {
    // Nombres únicos: el agente cita documentos por nombre.
    let unique = name;
    for (let i = 2; state.documents.some((d) => d.name === unique); i++) unique = `${name} (${i})`;
    const doc = { id: crypto.randomUUID(), name: unique, text, chars: text.length, uploadedAt: new Date().toISOString() };
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
    const version = { id: crypto.randomUUID(), n, createdAt: new Date().toISOString(), ...v };
    state.versions.push(version);
    save();
    return version;
  },

  getVersion: (id) => state.versions.find((v) => v.id === id),

  removeVersion(id) {
    state.versions = state.versions.filter((v) => v.id !== id);
    save();
  },

  setSetting(key, value) {
    state.settings = { ...(state.settings || {}), [key]: value };
    save();
  },

  reset() {
    // Reiniciar borra documentos, análisis y controles, pero conserva la configuración (modelo elegido).
    state = { ...empty(), settings: state.settings || {} };
    save();
  },
};
