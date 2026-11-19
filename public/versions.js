// Versiones del diagnóstico: resumen que se guarda en cada versión y comparación entre dos versiones.
// El resumen es autosuficiente (no depende del catálogo actual), así una versión vieja se puede comparar
// aunque después se haya editado el catálogo o la valoración.
import { round1 } from './scoring.js';

/** Resumen compacto de un dashboard calculado, para guardar en una versión. */
export function versionSummary(d) {
  return {
    index: d.index,
    baseIndex: d.baseIndex,
    label: d.label,
    counts: d.counts,
    total: d.total,
    appliedCount: d.appliedCount,
    company: d.company,
    catalogTitle: d.catalogTitle,
    controls: d.controls.map((c) => ({ id: c.id, name: c.name, score: c.score, weightPct: c.weightPct })),
    safeguards: d.safeguards.map((s) => ({
      id: s.id,
      title: s.title,
      controlId: s.controlId,
      status: s.status,
      documented: s.documented,
      overridden: s.overridden,
    })),
  };
}

// Orden de "mejor a peor" para decidir si un cambio de estado es una mejora o un retroceso.
const RANK = { implementado: 3, parcial: 2, no_implementado: 1, sin_evidencia: 1 };

/**
 * Compara dos resúmenes (A = referencia, B = comparado).
 * Devuelve deltas de índice, conteos, controles y la lista de salvaguardas que cambiaron.
 */
export function compareVersions(a, b) {
  const counts = Object.fromEntries(
    Object.keys({ ...a.counts, ...b.counts }).map((k) => [k, { a: a.counts[k] || 0, b: b.counts[k] || 0, delta: (b.counts[k] || 0) - (a.counts[k] || 0) }])
  );

  const ctrlA = new Map(a.controls.map((c) => [c.id, c]));
  const ctrlB = new Map(b.controls.map((c) => [c.id, c]));
  const controls = [...new Set([...ctrlA.keys(), ...ctrlB.keys()])].map((id) => {
    const ca = ctrlA.get(id);
    const cb = ctrlB.get(id);
    return {
      id,
      name: (cb || ca).name,
      a: ca ? ca.score : null,
      b: cb ? cb.score : null,
      delta: ca && cb ? round1(cb.score - ca.score) : null,
    };
  });

  const sgA = new Map(a.safeguards.map((s) => [s.id, s]));
  const changes = [];
  for (const sb of b.safeguards) {
    const sa = sgA.get(sb.id);
    if (!sa) {
      changes.push({ id: sb.id, title: sb.title, controlId: sb.controlId, from: null, to: sb.status, direction: 'nueva' });
    } else if (sa.status !== sb.status) {
      const d = RANK[sb.status] - RANK[sa.status];
      changes.push({
        id: sb.id,
        title: sb.title,
        controlId: sb.controlId,
        from: sa.status,
        to: sb.status,
        direction: d > 0 ? 'mejora' : d < 0 ? 'retroceso' : 'neutral',
        applied: sb.overridden && !sa.overridden,
      });
    }
  }
  for (const sa of a.safeguards) {
    if (!b.safeguards.some((s) => s.id === sa.id)) {
      changes.push({ id: sa.id, title: sa.title, controlId: sa.controlId, from: sa.status, to: null, direction: 'eliminada' });
    }
  }

  return {
    index: { a: a.index, b: b.index, delta: round1(b.index - a.index) },
    counts,
    controls,
    changes,
    improved: changes.filter((c) => c.direction === 'mejora').length,
    worsened: changes.filter((c) => c.direction === 'retroceso').length,
  };
}
