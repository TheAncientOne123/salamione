// Carga el catálogo normativo (CIS Controls v8.1 IG1) desde el Markdown del proyecto
// y la valoración (valores por estado y pesos por control) desde config/valoracion.json.
// Es la ÚNICA fuente de dominios y salvaguardas: nada de esto está escrito a mano en el código.
import fs from 'node:fs';
import path from 'node:path';

const CATALOG_FILE = path.resolve(process.env.CIS_CATALOG || 'Catalogo_CIS_v8.1_IG1.md');
const VALUATION_FILE = path.resolve('config/valoracion.json');

export function parseCatalog(markdown) {
  const safeguards = [];
  for (const line of markdown.split(/\r?\n/)) {
    // | 1.1 | 1. Inventario y control ... | Salvaguarda | Descripción |
    const m = line.match(/^\|\s*(\d+\.\d+)\s*\|\s*(\d+)\.\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/);
    if (!m) continue;
    const [, id, controlId, controlName, title, description] = m;
    safeguards.push({ id, controlId, controlName, title, description });
  }
  const controls = [];
  for (const s of safeguards) {
    let c = controls.find((x) => x.id === s.controlId);
    if (!c) controls.push((c = { id: s.controlId, name: s.controlName, safeguards: [] }));
    c.safeguards.push(s.id);
  }
  const titleLine = markdown.match(/^#\s+(.+)$/m);
  const title = titleLine ? titleLine[1].trim() : 'Catálogo';
  // Nombre corto: lo que sigue al guion largo del título ("Catálogo de referencia — CIS Controls v8.1, ...").
  const shortName = (title.split(/\s+[—–-]\s+/)[1] || title).trim();
  // Alcance: párrafos de texto entre el título y la tabla (sin la línea de distribución).
  const scope = markdown
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\s*[#|]/.test(l) && !/^Distribuci[oó]n:/i.test(l) && !/^Nota:/i.test(l))
    .slice(0, 3)
    .join(' ')
    .trim();
  const note = (markdown.match(/^Nota:\s*(.+)$/m) || [])[1] || '';
  return { title, shortName, scope, note, safeguards, controls, maxPerControl: Math.max(0, ...controls.map((c) => c.safeguards.length)) };
}

function loadValuation(controls) {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(VALUATION_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[catálogo] No se pudo leer ${VALUATION_FILE}: ${e.message}`);
  }
  const values = {
    implementado: 100,
    parcial: 50,
    no_implementado: 0,
    sin_evidencia: 0,
    ...(cfg.valoresEstado || {}),
  };
  const weights = {};
  for (const c of controls) {
    // Por defecto, el peso de cada control = su cantidad de salvaguardas
    // (equivale a que las 56 salvaguardas valgan lo mismo).
    const w = Number(cfg.pesosControl?.[c.id]);
    weights[c.id] = Number.isFinite(w) && w >= 0 ? w : c.safeguards.length;
  }
  return { values, weights };
}

export function loadCatalog() {
  const md = fs.readFileSync(CATALOG_FILE, 'utf8');
  const catalog = parseCatalog(md);
  if (!catalog.safeguards.length) throw new Error(`No se encontraron salvaguardas en ${CATALOG_FILE}`);
  const { values, weights } = loadValuation(catalog.controls);
  for (const c of catalog.controls) c.weight = weights[c.id];
  catalog.values = values;
  catalog.source = path.basename(CATALOG_FILE);
  return catalog;
}
