// Modelo de indicadores compartido entre servidor, navegador, PDF y CSV.
// Todo sale del catálogo y de la evaluación verificada; acá no hay dominios fijos.
//
// Estados:
//   implementado (1) · parcial (0,5) · no_implementado (0) · no_verificado (—) · no_aplicable (—)
// Indicadores:
//   Implementación = (I + 0,5·P) / (I + P + N) × 100      → "No determinable" si I+P+N = 0
//   Cobertura      = (I + P + N) / (total del IG − No aplicables) × 100
// "No verificado" NO cuenta como incumplimiento (regla R8): queda fuera de la implementación
// y baja la cobertura.

export const STATUS = {
  implementado: { label: 'Implementado', long: 'Implementado', key: 'bajo' },
  parcial: { label: 'Parcial', long: 'Parcialmente implementado', key: 'medio' },
  no_implementado: { label: 'No implementado', long: 'No implementado', key: 'critico' },
  no_verificado: { label: 'No verificado', long: 'No verificado', key: 'nd' },
  no_aplicable: { label: 'No aplicable', long: 'No aplicable', key: 'na' },
};
export const STATUS_IDS = Object.keys(STATUS);
export const EVALUABLE = ['implementado', 'parcial', 'no_implementado'];
// Estados que el usuario puede aplicar como simulación (los demás surgen de la evidencia).
export const APPLICABLE = ['no_implementado', 'parcial', 'implementado'];
export const APPLICABILITY = { aplica: 'Aplica', no_aplica: 'No aplica', por_determinar: 'Por determinar' };
export const SEVERITY = { alta: 'Alta', media: 'Media', baja: 'Baja' };
export const EFFORT = { bajo: 'Bajo', medio: 'Medio', alto: 'Alto' };
export const INIT_TYPE = { quick_win: 'Quick win', proyecto: 'Inversión o proyecto' };

/** Compatibilidad: evaluaciones viejas usaban "sin_evidencia". */
export const normStatus = (s) => (s === 'sin_evidencia' ? 'no_verificado' : STATUS[s] ? s : 'no_verificado');

export function healthLabel(pct) {
  if (pct == null) return { key: 'nd', label: 'No determinable' };
  if (pct >= 80) return { key: 'bajo', label: 'Saludable' };
  if (pct >= 60) return { key: 'medio', label: 'Aceptable' };
  if (pct >= 40) return { key: 'alto', label: 'En riesgo' };
  return { key: 'critico', label: 'Crítico' };
}

export const round1 = (n) => Math.round(n * 10) / 10;
export const fmt = (n) => (n == null ? 'N/D' : round1(n).toLocaleString('es-AR', { maximumFractionDigits: 1 }));
export const pct = (n) => (n == null ? 'No determinable' : `${fmt(n)}%`);

const DEFAULT_VALUES = { implementado: 1, parcial: 0.5, no_implementado: 0 };

/** Conteos e indicadores para una lista de estados. */
export function indicators(statuses, values = DEFAULT_VALUES) {
  const counts = Object.fromEntries(STATUS_IDS.map((k) => [k, 0]));
  for (const s of statuses) counts[s]++;
  const evaluable = counts.implementado + counts.parcial + counts.no_implementado;
  const applicable = statuses.length - counts.no_aplicable;
  const implementation = evaluable
    ? round1((100 * (values.implementado * counts.implementado + values.parcial * counts.parcial + values.no_implementado * counts.no_implementado)) / evaluable)
    : null;
  const coverage = applicable ? round1((100 * evaluable) / applicable) : null;
  return { counts, evaluable, applicable, implementation, coverage, total: statuses.length };
}

const RANK = { no_implementado: 0, parcial: 1, no_verificado: 2, implementado: 3, no_aplicable: 4 };
const cmpId = (a, b) => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
};

/** Estado de un riesgo según sus salvaguardas: mitigado, reducido o vigente. */
export function riskState(linked) {
  if (!linked.length) return 'vigente';
  if (linked.every((s) => s.status === 'implementado')) return 'mitigado';
  if (linked.some((s) => s.status === 'implementado' || s.status === 'parcial')) return 'reducido';
  return 'vigente';
}
export const RISK_STATE = { vigente: 'Vigente', reducido: 'Reducido', mitigado: 'Mitigado' };

/** Avance de una iniciativa según sus salvaguardas. */
export function initiativeProgress(linked) {
  if (!linked.length) return { pct: 0, state: 'pendiente' };
  const p = (100 * linked.reduce((a, s) => a + (s.status === 'implementado' ? 1 : s.status === 'parcial' ? 0.5 : 0), 0)) / linked.length;
  return { pct: round1(p), state: p >= 100 ? 'completada' : p > 0 ? 'en_progreso' : 'pendiente' };
}
export const INIT_STATE = { pendiente: 'Pendiente', en_progreso: 'En progreso', completada: 'Completada' };

/**
 * @param catalog   { controls:[{id,name,safeguards}], safeguards:[{id,controlId,controlName,title,description}], values, title, shortName }
 * @param analysis  { company, context, assessments:{[id]:{status,applicability,evidence,rationale,observations}}, risks, initiatives, engine, generatedAt, stats }
 * @param overrides { [id]: estado aplicado como simulación }
 */
export function computeDashboard(catalog, analysis, overrides = {}) {
  const V = { ...DEFAULT_VALUES, ...(catalog.values || {}) };

  const safeguards = catalog.safeguards.map((s) => {
    const a = analysis.assessments?.[s.id] || {};
    const documented = normStatus(a.status);
    const status = APPLICABLE.includes(overrides[s.id]) ? overrides[s.id] : documented;
    const applicability =
      status === 'no_aplicable' ? 'no_aplica' : APPLICABILITY[a.applicability] && a.applicability !== 'no_aplica' ? a.applicability : status === 'no_verificado' ? 'por_determinar' : 'aplica';
    return {
      ...s,
      documented,
      status,
      applicability,
      overridden: status !== documented,
      evidence: a.evidence || [],
      rationale: a.rationale || '',
      observations: a.observations || '',
      downgraded: !!a.downgraded,
      history: a.history || [],
      value: EVALUABLE.includes(status) ? V[status] : null,
    };
  });
  const byId = Object.fromEntries(safeguards.map((s) => [s.id, s]));

  const all = indicators(safeguards.map((s) => s.status), V);
  const base = indicators(safeguards.map((s) => s.documented), V);

  const controls = catalog.controls.map((c) => {
    const sg = c.safeguards.map((id) => byId[id]);
    const ind = indicators(sg.map((s) => s.status), V);
    const b = indicators(sg.map((s) => s.documented), V);
    return {
      id: c.id,
      name: c.name,
      safeguards: c.safeguards,
      counts: ind.counts,
      implementation: ind.implementation,
      coverage: ind.coverage,
      baseImplementation: b.implementation,
      label: healthLabel(ind.implementation),
    };
  });

  // Mejora del indicador de implementación si la salvaguarda pasa a "implementado".
  for (const s of safeguards) {
    if (s.status === 'implementado' || s.status === 'no_aplicable') {
      s.gain = 0;
      continue;
    }
    const sim = safeguards.map((x) => (x.id === s.id ? 'implementado' : x.status));
    const after = indicators(sim, V).implementation;
    s.gain = round1(after - (all.implementation ?? 0));
  }
  // Prioridades: primero brechas confirmadas, luego parciales; a igual estado, mayor mejora.
  const priorities = safeguards
    .filter((s) => s.status === 'no_implementado' || s.status === 'parcial')
    .sort((a, b) => RANK[a.status] - RANK[b.status] || b.gain - a.gain || cmpId(a.id, b.id));

  const risks = (analysis.risks || []).map((r) => {
    const linked = r.safeguards.map((id) => byId[id]).filter(Boolean);
    return { ...r, linked: linked.map((s) => ({ id: s.id, title: s.title, status: s.status })), state: riskState(linked) };
  });
  const initiatives = (analysis.initiatives || []).map((i) => {
    const linked = i.safeguards.map((id) => byId[id]).filter(Boolean);
    return { ...i, linked: linked.map((s) => ({ id: s.id, title: s.title, status: s.status })), progress: initiativeProgress(linked) };
  });

  const d = {
    company: analysis.company || { name: 'No informado', sector: 'No informado' },
    context: analysis.context || null,
    engine: analysis.engine,
    generatedAt: analysis.generatedAt,
    updatedAt: analysis.updatedAt || null,
    stats: analysis.stats || {},
    catalogTitle: catalog.title,
    shortName: catalog.shortName,
    ig: catalog.ig || 1,
    total: safeguards.length,
    counts: all.counts,
    baseCounts: base.counts,
    evaluable: all.evaluable,
    implementation: all.implementation,
    coverage: all.coverage,
    baseImplementation: base.implementation,
    baseCoverage: base.coverage,
    label: healthLabel(all.implementation),
    appliedCount: safeguards.filter((s) => s.overridden).length,
    safeguards,
    controls,
    priorities,
    risks,
    initiatives,
  };
  d.summary = executiveSummary(d);
  return d;
}

/** Resumen ejecutivo determinístico: solo usa datos verificados y cifras calculadas. */
export function executiveSummary(d) {
  const n = d.counts;
  const org = d.company.name !== 'No informado' ? d.company.name : 'La organización';
  const gaps = [...d.controls]
    .filter((c) => c.counts.no_implementado + c.counts.parcial > 0)
    .sort((a, b) => b.counts.no_implementado - a.counts.no_implementado || b.counts.parcial - a.counts.parcial)
    .slice(0, 3);
  const nvControls = [...d.controls].sort((a, b) => b.counts.no_verificado - a.counts.no_verificado).filter((c) => c.counts.no_verificado).slice(0, 3);
  const parts = [
    `${d.updatedAt ? "Postura actualizada" : "Postura inicial"}: ${org} presenta una implementación de ${pct(d.implementation)} sobre ${d.evaluable} salvaguardas evaluables (${d.label.label}) y una cobertura de evaluación de ${pct(d.coverage)} de las ${d.total} salvaguardas de ${d.shortName}.`,
    `Estados: ${n.implementado} implementadas, ${n.parcial} parcialmente implementadas, ${n.no_implementado} no implementadas, ${n.no_verificado} no verificadas y ${n.no_aplicable} no aplicables.`,
  ];
  if (gaps.length) parts.push(`Controles con mayores brechas: ${gaps.map((c) => `${c.id}. ${c.name} (${c.counts.no_implementado} no impl., ${c.counts.parcial} parciales)`).join('; ')}.`);
  if (n.no_verificado) {
    parts.push(
      `Información faltante: ${n.no_verificado} salvaguardas no pudieron verificarse${nvControls.length ? `, sobre todo en ${nvControls.map((c) => `${c.id}. ${c.name}`).join(', ')}` : ''}. No se cuentan como incumplimiento.`
    );
  }
  if (d.risks.length) parts.push(`Principales riesgos: ${d.risks.slice(0, 3).map((r) => `${r.title} (severidad ${SEVERITY[r.severity]?.toLowerCase() || r.severity})`).join('; ')}.`);
  if (d.appliedCount) parts.push(`Hay ${d.appliedCount} salvaguarda(s) con estado simulado manualmente; la implementación según evidencia es ${pct(d.baseImplementation)}.`);
  parts.push('Resultados preliminares: "Implementado" es una conclusión documental provisional sujeta a validación del auditor, no una certificación.');
  return parts;
}
