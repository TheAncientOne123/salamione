// Verificación anti-alucinación de todo lo que produce el agente (reglas R2, R3, R5, R6, R8).
// - Solo se aceptan salvaguardas del catálogo.
// - Solo se aceptan citas que aparecen textualmente en el documento indicado; se les agrega página o sección.
// - Un estado que exige evidencia (implementado, parcial, no implementado, no aplicable) sin cita verificada
//   se degrada a "no_verificado": la falta de evidencia nunca se convierte en incumplimiento.
// - Las afirmaciones de la ficha de contexto sin cita verificada se descartan.
import { normStatus, EVALUABLE } from '../shared/scoring.js';

export const norm = (s) =>
  String(s || '')
    .replace(/\[\[Página \d+\]\]/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”"'«»`´]/g, '')
    .replace(/[^a-z0-9ñ.,;:%/()\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** La cita (o cada fragmento separado por "...") debe estar en el texto del documento. */
export function quoteInText(quote, text) {
  const pieces = String(quote)
    .split(/\.\.\.|…|\[\.\.\.\]/)
    .map(norm)
    .filter((p) => p.length >= 3);
  if (!pieces.length) return false;
  const hay = norm(text);
  const longEnough = pieces.reduce((a, p) => a + p.length, 0) >= 12;
  return longEnough && pieces.every((p) => hay.includes(p));
}

/** Página (PDF) o sección (encabezado Markdown) donde aparece la cita. */
export function locateRef(quote, text) {
  if (/\[\[Página \d+\]\]/.test(text)) {
    const parts = text.split(/\[\[Página (\d+)\]\]/); // ['', '1', texto1, '2', texto2, ...]
    for (let i = 1; i < parts.length; i += 2) if (quoteInText(quote, parts[i + 1])) return `p. ${parts[i]}`;
    return null;
  }
  const lines = text.split(/\r?\n/);
  let heading = null;
  let block = '';
  const sections = [];
  for (const l of lines) {
    const h = l.match(/^#{1,6}\s+(.+)$/);
    if (h) {
      sections.push({ heading, block });
      heading = h[1].trim();
      block = '';
    } else block += l + '\n';
  }
  sections.push({ heading, block });
  const hit = sections.find((s) => quoteInText(quote, s.block));
  return hit?.heading ? `§ ${hit.heading}` : null;
}

/** Verifica una lista de citas: descarta las que no están y agrega la referencia. */
export function verifyEvidence(list, documents, stats) {
  const docs = new Map(documents.map((d) => [d.name, d.text]));
  const out = [];
  for (const e of list || []) {
    if (stats) stats.quotes++;
    const doc = docs.has(e.document) && quoteInText(e.quote, docs.get(e.document)) ? e.document : documents.find((d) => quoteInText(e.quote, d.text))?.name;
    if (!doc) {
      if (stats) stats.rejectedQuotes++;
      continue;
    }
    const quote = String(e.quote).replace(/\[\[Página \d+\]\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!out.some((x) => x.quote === quote)) out.push({ document: doc, quote, ref: locateRef(e.quote, docs.get(doc)) });
  }
  return out;
}

const newStats = () => ({ quotes: 0, rejectedQuotes: 0, downgraded: 0, unknownIds: 0, missing: 0, droppedFindings: 0 });

export const CONTEXT_DIMENSIONS = {
  organizacion: 'Organización',
  procesos: 'Procesos',
  infraestructura: 'Infraestructura',
  activos: 'Activos',
  identidades: 'Identidades',
  proteccion: 'Protección',
  recuperacion: 'Recuperación',
  monitoreo: 'Monitoreo',
  gobierno: 'Gobierno',
  restricciones: 'Restricciones',
};

/** Ficha de contexto (etapa 2): solo quedan las afirmaciones con cita verificada. */
export function verifyContext(raw, documents, stats = newStats()) {
  const dims = Object.keys(CONTEXT_DIMENSIONS).map((id) => {
    const d = (raw?.dimensions || []).find((x) => x.id === id) || {};
    const findings = [];
    for (const f of d.findings || []) {
      const ev = verifyEvidence(f.evidence, documents, stats);
      if (ev.length) findings.push({ statement: String(f.statement || '').slice(0, 300), evidence: ev.slice(0, 2) });
      else stats.droppedFindings++;
    }
    const missing = (d.missing || []).map((m) => String(m).slice(0, 200)).filter(Boolean).slice(0, 5);
    if (!findings.length && id !== 'restricciones' && !missing.length) missing.push('El documento no aporta información sobre esta dimensión.');
    return { id, name: CONTEXT_DIMENSIONS[id], findings: findings.slice(0, 5), missing };
  });
  return { dimensions: dims };
}

/** Evaluación de las salvaguardas del IG (etapa 3). */
export function verifyAssessments(raw, documents, catalog, stats = newStats()) {
  const valid = new Set(catalog.safeguards.map((s) => s.id));
  const assessments = {};
  for (const item of raw?.safeguards || []) {
    if (!valid.has(item.id)) {
      stats.unknownIds++;
      continue;
    }
    if (assessments[item.id]) continue; // duplicados: vale el primero
    let status = normStatus(item.status);
    const evidence = verifyEvidence(item.evidence, documents, stats).slice(0, 3);
    let downgraded = false;
    if (status !== 'no_verificado' && !evidence.length) {
      status = 'no_verificado';
      downgraded = true;
      stats.downgraded++;
    }
    let applicability = ['aplica', 'no_aplica', 'por_determinar'].includes(item.applicability) ? item.applicability : 'por_determinar';
    if (status === 'no_aplicable') applicability = 'no_aplica';
    else if (applicability === 'no_aplica') applicability = 'por_determinar'; // "no aplica" exige estado no_aplicable con justificación
    if (EVALUABLE.includes(status)) applicability = 'aplica';
    assessments[item.id] = {
      status,
      applicability,
      evidence,
      rationale: String(item.rationale || '').slice(0, 600),
      observations: String(item.observations || (downgraded ? 'La cita propuesta no se encontró en el documento; queda como no verificada.' : '')).slice(0, 400),
      downgraded,
    };
  }
  for (const id of valid) {
    if (!assessments[id]) {
      stats.missing++;
      assessments[id] = {
        status: 'no_verificado',
        applicability: 'por_determinar',
        evidence: [],
        rationale: 'La documentación no menciona esta salvaguarda.',
        observations: 'Información pendiente para determinar su estado.',
        downgraded: false,
      };
    }
  }
  return assessments;
}

/** Nombre y sector: solo si figuran textualmente. */
export function verifyCompany(raw, documents) {
  const allText = norm(documents.map((d) => d.text).join('\n'));
  const literal = (v) => {
    const s = String(v || '').trim();
    return s && s.length <= 120 && allText.includes(norm(s)) ? s : 'No informado';
  };
  return { name: literal(raw?.name), sector: literal(raw?.sector) };
}

/** Riesgos e iniciativas (etapa 4): ids de salvaguarda del catálogo y vinculados a brechas reales. */
export function verifyRoadmap(raw, assessments, catalog) {
  const valid = new Set(catalog.safeguards.map((s) => s.id));
  const isGap = (id) => valid.has(id) && assessments[id] && assessments[id].status !== 'implementado' && assessments[id].status !== 'no_aplicable';
  const risks = [];
  for (const r of raw?.risks || []) {
    const sg = [...new Set((r.safeguards || []).filter(isGap))];
    if (!sg.length) continue;
    risks.push({
      id: `R${risks.length + 1}`,
      srcId: r.id,
      title: String(r.title || '').slice(0, 120),
      description: String(r.description || '').slice(0, 400),
      asset: String(r.asset || '').slice(0, 200),
      deficiency: String(r.deficiency || '').slice(0, 300),
      consequence: String(r.consequence || '').slice(0, 300),
      severity: ['alta', 'media', 'baja'].includes(r.severity) ? r.severity : 'media',
      justification: String(r.justification || '').slice(0, 400),
      safeguards: sg,
    });
    if (risks.length === 5) break;
  }
  const riskMap = new Map(risks.map((r) => [r.srcId, r.id]));
  const initiatives = [];
  for (const i of raw?.initiatives || []) {
    const sg = [...new Set((i.safeguards || []).filter(isGap))];
    if (!sg.length) continue;
    const effort = ['bajo', 'medio', 'alto'].includes(i.effort) ? i.effort : 'medio';
    let type = i.type === 'quick_win' ? 'quick_win' : 'proyecto';
    if (effort === 'alto') type = 'proyecto'; // un esfuerzo alto no puede ser quick win
    initiatives.push({
      id: `I${initiatives.length + 1}`,
      name: String(i.name || '').slice(0, 120),
      description: String(i.description || '').slice(0, 400),
      risks: (i.risks || []).map((x) => riskMap.get(x)).filter(Boolean),
      safeguards: sg,
      benefit: String(i.benefit || '').slice(0, 300),
      effort,
      type,
      priority: 0,
    });
    if (initiatives.length === 5) break;
  }
  initiatives
    .map((x, k) => ({ x, p: Number((raw.initiatives || [])[k]?.priority) || k + 1 }))
    .sort((a, b) => a.p - b.p)
    .forEach((o, k) => (o.x.priority = k + 1));
  initiatives.sort((a, b) => a.priority - b.priority);
  for (const r of risks) delete r.srcId;
  return { risks, initiatives };
}

/** Propuesta de actualización por nueva evidencia (etapa 5). El estado inicial lo pone el sistema, no el modelo. */
export function verifyProposal(raw, newDocs, assessments, catalog, stats = newStats()) {
  const valid = new Set(catalog.safeguards.map((s) => s.id));
  const changes = [];
  for (const c of raw?.changes || []) {
    if (!valid.has(c.id) || changes.some((x) => x.id === c.id)) continue;
    const from = normStatus(assessments[c.id]?.status);
    const proposed = normStatus(c.proposed);
    const evidence = verifyEvidence(c.evidence, newDocs, stats).slice(0, 3);
    const supported = evidence.length > 0;
    changes.push({
      id: c.id,
      from,
      // Sin evidencia verificada no se propone ningún cambio (se mantiene el estado, R11).
      proposed: supported ? proposed : from,
      justification: String(c.justification || '').slice(0, 500),
      pending: String(c.pending || '').slice(0, 300),
      evidence,
      supported,
      decision: supported && proposed !== from ? 'pendiente' : 'sin_cambio',
    });
  }
  const initiatives = (raw?.initiatives || []).slice(0, 10).map((i) => ({
    name: String(i.name || '').slice(0, 120),
    improved: String(i.improved || '').slice(0, 400),
    safeguards: (i.safeguards || []).filter((id) => valid.has(id)),
    evidence: verifyEvidence(i.evidence, newDocs, stats).slice(0, 2),
    completeness: i.completeness === 'completa' ? 'completa' : 'parcial',
    pending: String(i.pending || '').slice(0, 300),
  }));
  return { changes, initiatives };
}

export { newStats };
