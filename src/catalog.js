// Catálogo normativo: CIS Controls v8.1 completo (153 salvaguardas, IG1/IG2/IG3) desde catalog/CIS_Controls_v8.1.md,
// y valoración de estados desde config/valoracion.json.
// Es la ÚNICA fuente de controles y salvaguardas: nada de esto está escrito a mano en el código.
// loadCatalog(ig) devuelve el subconjunto acumulado: IG1 = 56, IG2 = 130, IG3 = 153.
import fs from 'node:fs';
import path from 'node:path';

const CATALOG_FILE = path.resolve(process.env.CIS_CATALOG || 'catalog/CIS_Controls_v8.1.md');
const VALUATION_FILE = path.resolve('config/valoracion.json');
export const IGS = [1, 2, 3];

export function parseCatalog(markdown) {
  const all = [];
  for (const line of markdown.split(/\r?\n/)) {
    // | 1.1 | 1. Inventario ... | Salvaguarda | Descripción | IG1 |
    const m = line.match(/^\|\s*(\d+\.\d+)\s*\|\s*(\d+)\.\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(?:IG([123])\s*\|)?\s*$/);
    if (!m) continue;
    const [, id, controlId, controlName, title, description, ig] = m;
    all.push({ id, controlId, controlName, title, description, ig: Number(ig || 1) });
  }
  const titleLine = markdown.match(/^#\s+(.+)$/m);
  const note = (markdown.match(/^Nota:\s*(.+)$/m) || [])[1] || '';
  return { title: titleLine ? titleLine[1].trim() : 'Catálogo', note, all };
}

/** Subconjunto acumulado para un IG objetivo. */
export function catalogFor(parsed, ig = 1) {
  const level = IGS.includes(Number(ig)) ? Number(ig) : 1;
  const safeguards = parsed.all.filter((s) => s.ig <= level);
  const controls = [];
  for (const s of safeguards) {
    let c = controls.find((x) => x.id === s.controlId);
    if (!c) controls.push((c = { id: s.controlId, name: s.controlName, safeguards: [] }));
    c.safeguards.push(s.id);
  }
  const present = new Set(controls.map((c) => c.id));
  const missing = [...new Set(parsed.all.map((s) => s.controlId))].filter((id) => !present.has(id));
  const shortName = `CIS Controls v8.1 IG${level}`;
  const scope =
    `Evaluación contra ${shortName}: ${safeguards.length} salvaguardas en ${controls.length} controles` +
    (level > 1 ? ` (incluye las de IG${level === 2 ? '1' : '1 e IG2'}).` : '.') +
    (missing.length ? ` Los controles ${missing.join(', ').replace(/, (\d+)$/, ' y $1')} no tienen salvaguardas en IG${level} y quedan fuera de este alcance.` : '');
  return {
    title: `${parsed.title} — Implementation Group ${level} (IG${level})`,
    shortName,
    ig: level,
    scope,
    note: parsed.note,
    safeguards,
    controls,
    maxPerControl: Math.max(0, ...controls.map((c) => c.safeguards.length)),
  };
}

function loadValuation() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(VALUATION_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[catálogo] No se pudo leer ${VALUATION_FILE}: ${e.message}`);
  }
  return { implementado: 1, parcial: 0.5, no_implementado: 0, ...(cfg.valoresEstado || {}) };
}

let parsed = null;
const cache = new Map();

export function loadCatalog(ig = 1) {
  if (!parsed) {
    parsed = parseCatalog(fs.readFileSync(CATALOG_FILE, 'utf8'));
    if (!parsed.all.length) throw new Error(`No se encontraron salvaguardas en ${CATALOG_FILE}`);
  }
  const level = IGS.includes(Number(ig)) ? Number(ig) : 1;
  if (!cache.has(level)) {
    const c = catalogFor(parsed, level);
    c.values = loadValuation();
    c.source = path.basename(CATALOG_FILE);
    cache.set(level, c);
  }
  return cache.get(level);
}
