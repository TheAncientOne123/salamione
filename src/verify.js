// Verificación anti-alucinación de la salida del agente.
// - Solo se aceptan salvaguardas que existen en el catálogo.
// - Solo se aceptan citas que aparecen literalmente en el documento indicado.
// - Un estado distinto de "sin_evidencia" sin al menos una cita verificada se degrada a "sin_evidencia".
// - Nombre y sector de la empresa solo se aceptan si figuran textualmente en la documentación.
import { STATUS } from '../public/scoring.js';

export const norm = (s) =>
  String(s || '')
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

export function verifyAnalysis(raw, documents, catalog) {
  const docs = new Map(documents.map((d) => [d.name, d.text]));
  const allText = documents.map((d) => d.text).join('\n');
  const valid = new Set(catalog.safeguards.map((s) => s.id));
  const stats = { quotes: 0, rejectedQuotes: 0, downgraded: 0, unknownIds: 0, missing: 0 };
  const assessments = {};

  for (const item of raw?.safeguards || []) {
    if (!valid.has(item.id)) {
      stats.unknownIds++;
      continue;
    }
    if (assessments[item.id]) continue; // duplicados: vale el primero
    let status = STATUS[item.status] ? item.status : 'sin_evidencia';
    const evidence = [];
    for (const e of item.evidence || []) {
      stats.quotes++;
      // Si el documento indicado no existe, se busca la cita en cualquier documento.
      const doc = docs.has(e.document) ? e.document : documents.find((d) => quoteInText(e.quote, d.text))?.name;
      if (doc && quoteInText(e.quote, docs.get(doc))) evidence.push({ document: doc, quote: String(e.quote).trim().slice(0, 400) });
      else stats.rejectedQuotes++;
    }
    let downgraded = false;
    if (status !== 'sin_evidencia' && !evidence.length) {
      status = 'sin_evidencia';
      downgraded = true;
      stats.downgraded++;
    }
    assessments[item.id] = { status, evidence: evidence.slice(0, 3), rationale: String(item.rationale || '').slice(0, 600), downgraded };
  }
  for (const id of valid) {
    if (!assessments[id]) {
      stats.missing++;
      assessments[id] = { status: 'sin_evidencia', evidence: [], rationale: 'La documentación no menciona esta salvaguarda.', downgraded: false };
    }
  }

  const literal = (v) => {
    const s = String(v || '').trim();
    return s && s.length <= 120 && norm(allText).includes(norm(s)) ? s : 'No informado';
  };
  return {
    company: { name: literal(raw?.company?.name), sector: literal(raw?.company?.sector) },
    assessments,
    stats,
  };
}
