// Modelo de puntaje compartido entre servidor, navegador y PDF.
// Todo sale del catálogo (controles + salvaguardas + valoración); acá no hay dominios fijos.
//
// - Cada salvaguarda tiene un estado: implementado | parcial | no_implementado | sin_evidencia.
// - El estado "documentado" lo determina el agente a partir de la documentación (con citas verificadas).
// - El usuario (o el chat) puede aplicar controles: eso sobrescribe el estado y el dashboard se recalcula.
// - Valor de la salvaguarda = catalog.values[estado] (0-100).
// - Puntaje de un control CIS = promedio de sus salvaguardas.
// - Índice global = promedio de los controles ponderado por catalog.controls[].weight.

export const STATUS = {
  implementado: { label: 'Implementado', key: 'bajo' },
  parcial: { label: 'Parcial', key: 'medio' },
  no_implementado: { label: 'No implementado', key: 'critico' },
  sin_evidencia: { label: 'Sin evidencia', key: 'nd' },
};
export const STATUS_IDS = Object.keys(STATUS);
// Estados que el usuario puede aplicar (sin_evidencia solo lo asigna el análisis).
export const APPLICABLE = ['no_implementado', 'parcial', 'implementado'];

export function healthLabel(h) {
  if (h >= 80) return { key: 'bajo', label: 'Saludable' };
  if (h >= 60) return { key: 'medio', label: 'Aceptable' };
  if (h >= 40) return { key: 'alto', label: 'En riesgo' };
  return { key: 'critico', label: 'Crítico' };
}

export const round1 = (n) => Math.round(n * 10) / 10;
export const fmt = (n) => round1(n).toLocaleString('es-AR', { maximumFractionDigits: 1 });

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function weightedIndex(catalog, scoreOf) {
  let num = 0;
  let den = 0;
  for (const c of catalog.controls) {
    num += c.weight * scoreOf(c);
    den += c.weight;
  }
  return den ? num / den : 0;
}

/**
 * @param catalog   { controls:[{id,name,safeguards:[ids],weight}], safeguards:[{id,controlId,title,description}], values }
 * @param analysis  { company, assessments: { [id]: {status, evidence, rationale} }, engine, generatedAt, stats }
 * @param overrides { [safeguardId]: 'implementado'|'parcial'|'no_implementado' }
 */
export function computeDashboard(catalog, analysis, overrides = {}) {
  const V = catalog.values;
  const totalWeight = catalog.controls.reduce((a, c) => a + c.weight, 0) || 1;

  const safeguards = catalog.safeguards.map((s) => {
    const a = analysis.assessments?.[s.id] || { status: 'sin_evidencia', evidence: [], rationale: '' };
    const documented = STATUS[a.status] ? a.status : 'sin_evidencia';
    const status = APPLICABLE.includes(overrides[s.id]) ? overrides[s.id] : documented;
    return {
      ...s,
      documented,
      status,
      overridden: status !== documented,
      evidence: a.evidence || [],
      rationale: a.rationale || '',
      downgraded: !!a.downgraded,
      value: V[status],
      baseValue: V[documented],
    };
  });
  const byId = Object.fromEntries(safeguards.map((s) => [s.id, s]));

  const controls = catalog.controls.map((c) => {
    const sg = c.safeguards.map((id) => byId[id]);
    const score = avg(sg.map((s) => s.value));
    const baseScore = avg(sg.map((s) => s.baseValue));
    const counts = Object.fromEntries(STATUS_IDS.map((k) => [k, sg.filter((s) => s.status === k).length]));
    return {
      id: c.id,
      name: c.name,
      weight: c.weight,
      weightPct: (100 * c.weight) / totalWeight,
      safeguards: c.safeguards,
      score: round1(score),
      baseScore: round1(baseScore),
      label: healthLabel(score),
      counts,
    };
  });
  const ctrlById = Object.fromEntries(controls.map((c) => [c.id, c]));

  const index = round1(weightedIndex(catalog, (c) => ctrlById[c.id].score));
  const baseIndex = round1(weightedIndex(catalog, (c) => ctrlById[c.id].baseScore));

  // Mejora del índice si la salvaguarda pasa a "implementado".
  for (const s of safeguards) {
    const c = ctrlById[s.controlId];
    s.gain = round1(((c.weight / totalWeight) * (V.implementado - s.value)) / c.safeguards.length);
  }

  const counts = Object.fromEntries(STATUS_IDS.map((k) => [k, safeguards.filter((s) => s.status === k).length]));
  const baseCounts = Object.fromEntries(STATUS_IDS.map((k) => [k, safeguards.filter((s) => s.documented === k).length]));
  const priorities = safeguards
    .filter((s) => s.status !== 'implementado' && s.gain > 0)
    // A igual mejora, primero las brechas confirmadas por la documentación.
    .sort((a, b) => b.gain - a.gain || RANK[a.status] - RANK[b.status] || cmpId(a.id, b.id));

  const d = {
    company: analysis.company || { name: 'No informado', sector: 'No informado' },
    engine: analysis.engine,
    generatedAt: analysis.generatedAt,
    stats: analysis.stats || {},
    catalogTitle: catalog.title,
    index,
    baseIndex,
    label: healthLabel(index),
    baseLabel: healthLabel(baseIndex),
    counts,
    baseCounts,
    total: safeguards.length,
    appliedCount: safeguards.filter((s) => s.overridden).length,
    safeguards,
    controls,
    priorities,
  };
  d.summary = executiveSummary(d);
  return d;
}

const RANK = { no_implementado: 0, parcial: 1, sin_evidencia: 2, implementado: 3 };

function cmpId(a, b) {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
}

/** Resumen ejecutivo determinístico: solo usa números calculados, nada redactado por el modelo. */
export function executiveSummary(d) {
  const worst = [...d.controls].sort((a, b) => a.score - b.score).slice(0, 3);
  const best = [...d.controls].sort((a, b) => b.score - a.score)[0];
  const n = d.counts;
  const parts = [
    `${d.company.name !== 'No informado' ? d.company.name : 'La organización'} alcanza un índice de cumplimiento de ${fmt(d.index)}/100 (${d.label.label}) frente a las ${d.total} salvaguardas de ${d.catalogTitle.replace(/^Catálogo de referencia — /, '')}.`,
    `Salvaguardas: ${n.implementado} implementada${n.implementado === 1 ? '' : 's'}, ${n.parcial} parcial${n.parcial === 1 ? '' : 'es'}, ${n.no_implementado} no implementada${n.no_implementado === 1 ? '' : 's'} y ${n.sin_evidencia} sin evidencia en la documentación provista.`,
    `Los controles más débiles son ${worst.map((c) => `${c.id}. ${c.name} (${fmt(c.score)})`).join(', ')}.`,
  ];
  if (best && best.score > 0) parts.push(`El control mejor posicionado es ${best.id}. ${best.name} (${fmt(best.score)}).`);
  if (d.appliedCount) {
    parts.push(`Con ${d.appliedCount === 1 ? 'el control aplicado' : `los ${d.appliedCount} controles aplicados`} sobre lo documentado, el índice pasa de ${fmt(d.baseIndex)} a ${fmt(d.index)}.`);
  }
  if (d.priorities.length) {
    const top = d.priorities.slice(0, 3);
    parts.push(`Prioridades inmediatas: ${top.map((s) => `${s.id} ${s.title} (+${fmt(s.gain)} pts)`).join('; ')}.`);
  }
  return parts;
}
