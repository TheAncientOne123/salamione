// Versiones del diagnóstico: resumen que se guarda en cada versión y comparación entre dos versiones.
// El resumen es autosuficiente (no depende del catálogo actual), así una versión vieja se puede comparar
// aunque después se haya editado el catálogo o la valoración.
import { round1 } from './scoring.js';

/** Resumen compacto de un dashboard calculado, para guardar en una versión. */
export function versionSummary(d) {
  return {
    implementation: d.implementation,
    coverage: d.coverage,
    evaluable: d.evaluable,
    label: d.label,
    counts: d.counts,
    total: d.total,
    appliedCount: d.appliedCount,
    company: d.company,
    catalogTitle: d.catalogTitle,
    shortName: d.shortName,
    controls: d.controls.map((c) => ({ id: c.id, name: c.name, implementation: c.implementation, coverage: c.coverage })),
    safeguards: d.safeguards.map((s) => ({ id: s.id, title: s.title, controlId: s.controlId, status: s.status, documented: s.documented, overridden: s.overridden })),
    risks: d.risks.map((r) => ({ id: r.id, title: r.title, severity: r.severity, state: r.state, safeguards: r.safeguards })),
    initiatives: d.initiatives.map((i) => ({ id: i.id, name: i.name, type: i.type, progress: i.progress })),
  };
}

// Orden de "mejor a peor" para decidir si un cambio de estado es una mejora o un retroceso.
// "No verificado" → "No implementado" no es mejora ni retroceso: es más certeza (neutral).
const RANK = { implementado: 3, parcial: 2, no_implementado: 1, no_verificado: 1, no_aplicable: 1, sin_evidencia: 1 };
const dlt = (a, b) => (a == null || b == null ? null : round1(b - a));

/** Compara dos resúmenes (A = referencia, B = comparado). */
export function compareVersions(a, b) {
  const counts = Object.fromEntries(
    Object.keys({ ...a.counts, ...b.counts }).map((k) => [k, { a: a.counts[k] || 0, b: b.counts[k] || 0, delta: (b.counts[k] || 0) - (a.counts[k] || 0) }])
  );

  const ctrlA = new Map(a.controls.map((c) => [c.id, c]));
  const ctrlB = new Map(b.controls.map((c) => [c.id, c]));
  const controls = [...new Set([...ctrlA.keys(), ...ctrlB.keys()])].map((id) => {
    const ca = ctrlA.get(id);
    const cb = ctrlB.get(id);
    return { id, name: (cb || ca).name, a: ca?.implementation ?? null, b: cb?.implementation ?? null, delta: dlt(ca?.implementation, cb?.implementation) };
  });

  const sgA = new Map(a.safeguards.map((s) => [s.id, s]));
  const changes = [];
  for (const sb of b.safeguards) {
    const sa = sgA.get(sb.id);
    if (!sa) changes.push({ id: sb.id, title: sb.title, controlId: sb.controlId, from: null, to: sb.status, direction: 'nueva' });
    else if (sa.status !== sb.status) {
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
    if (!b.safeguards.some((s) => s.id === sa.id)) changes.push({ id: sa.id, title: sa.title, controlId: sa.controlId, from: sa.status, to: null, direction: 'eliminada' });
  }

  // Riesgos: cuáles cambiaron de estado y cuáles permanecen.
  const riskB = new Map((b.risks || []).map((r) => [r.title, r]));
  const risks = (a.risks || []).map((r) => {
    const rb = riskB.get(r.title);
    return { id: r.id, title: r.title, severity: r.severity, from: r.state, to: rb ? rb.state : null, changed: !!rb && rb.state !== r.state };
  });

  const out = {
    implementation: { a: a.implementation, b: b.implementation, delta: dlt(a.implementation, b.implementation) },
    coverage: { a: a.coverage, b: b.coverage, delta: dlt(a.coverage, b.coverage) },
    counts,
    controls,
    changes,
    risks,
    improved: changes.filter((c) => c.direction === 'mejora').length,
    worsened: changes.filter((c) => c.direction === 'retroceso').length,
  };
  out.verdict = verdict(out);
  return out;
}

/**
 * Veredicto del antes y el después: ¿los cambios mejoraron o empeoraron la postura?
 * Se basa en las salvaguardas que mejoraron o retrocedieron y en la variación de la implementación.
 * key: mejora | retroceso | mixto | sin_cambios
 */
export function verdict(c) {
  const di = c.implementation.delta ?? 0;
  const risksDown = c.risks.filter((r) => r.changed && RISK_RANK[r.to] > RISK_RANK[r.from]).length;
  const risksUp = c.risks.filter((r) => r.changed && RISK_RANK[r.to] < RISK_RANK[r.from]).length;
  let key;
  if (!c.improved && !c.worsened && Math.abs(di) < 0.05) key = 'sin_cambios';
  else if (c.improved && c.worsened) key = di > 0 ? 'mejora' : di < 0 ? 'retroceso' : 'mixto';
  else if (c.improved || di > 0) key = 'mejora';
  else key = 'retroceso';
  const mixed = c.improved && c.worsened;
  const sign = (n) => `${n > 0 ? '+' : ''}${n.toLocaleString('es', { maximumFractionDigits: 1 })}`;
  const label = { mejora: 'Mejoró', retroceso: 'Empeoró', mixto: 'Resultado mixto', sin_cambios: 'Sin cambios' }[key];
  const parts = [];
  if (key === 'sin_cambios') parts.push('No hay diferencias de estado entre las dos versiones.');
  else {
    parts.push(
      `La implementación pasó de ${fmtP(c.implementation.a)} a ${fmtP(c.implementation.b)} (${c.implementation.delta == null ? 'N/D' : `${sign(round1(di))} pts`}) y la cobertura de ${fmtP(c.coverage.a)} a ${fmtP(c.coverage.b)}.`
    );
    parts.push(`${c.improved} salvaguarda${c.improved === 1 ? '' : 's'} mejoraron y ${c.worsened} retrocedieron${mixed ? ': hay avances y retrocesos a la vez' : ''}.`);
    if (risksDown || risksUp) parts.push(`${risksDown} riesgo${risksDown === 1 ? '' : 's'} bajaron de nivel y ${risksUp} subieron.`);
  }
  return { key, label: mixed && key !== 'mixto' ? `${label} (con retrocesos)` : label, text: parts.join(' ') };
}

const RISK_RANK = { vigente: 0, reducido: 1, mitigado: 2 };
const fmtP = (n) => (n == null ? 'No determinable' : `${round1(n).toLocaleString('es', { maximumFractionDigits: 1 })}%`);
