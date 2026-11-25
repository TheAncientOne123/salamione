// Matriz de salvaguardas como CSV (separador ";" y BOM UTF-8 para Excel en español).
import { STATUS, APPLICABILITY, pct } from '../public/scoring.js';

const cell = (v) => {
  const s = String(v ?? '').replace(/\r?\n/g, ' ').trim();
  return /[";]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function matrixCsv(d, versionLabel = 'actual') {
  const header = [
    'Versión',
    'ID CIS',
    'Control CIS',
    'Salvaguarda',
    'Aplicabilidad',
    'Estado',
    'Valor',
    'Justificación',
    'Evidencia (documento, página/sección y cita)',
    'Observaciones',
    'Estado según evidencia',
    'Simulado manualmente',
  ];
  const rows = d.safeguards.map((s) => [
    versionLabel,
    s.id,
    `${s.controlId}. ${s.controlName}`,
    s.title,
    APPLICABILITY[s.applicability],
    STATUS[s.status].long,
    s.value == null ? '—' : String(s.value).replace('.', ','),
    s.rationale,
    s.evidence.map((e) => `${e.document}${e.ref ? ` (${e.ref})` : ''}: "${e.quote}"`).join(' | ') || 'Sin evidencia documental',
    [s.observations, ...(s.history || []).map((h) => `Actualizado de ${STATUS[h.from]?.long || h.from} a ${STATUS[h.to]?.long || h.to} con ${h.documents.join(', ')}`)]
      .filter(Boolean)
      .join(' · '),
    STATUS[s.documented].long,
    s.overridden ? 'Sí' : 'No',
  ]);
  const n = d.counts;
  const totals = [
    [],
    ['Indicadores'],
    [`Total de salvaguardas ${d.shortName}`, d.total],
    ['Implementadas', n.implementado],
    ['Parcialmente implementadas', n.parcial],
    ['No implementadas', n.no_implementado],
    ['No verificadas', n.no_verificado],
    ['No aplicables', n.no_aplicable],
    ['Implementación (sobre evaluables)', pct(d.implementation)],
    ['Cobertura de evaluación', pct(d.coverage)],
  ];
  return '﻿' + [header, ...rows, ...totals].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
