// Piezas de interfaz compartidas: Markdown del chat, número animado, chips de estado e íconos.
import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { STATUS, SEVERITY, RISK_STATE, INIT_STATE, fmt } from '@shared/scoring.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inline = (s) =>
  s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(«"])\*(?!\s)([^*]+?)\*(?=[\s.,;:)»"]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s.,)]|$)/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

/** Markdown mínimo y seguro (el texto se escapa antes de dar formato). */
export function mdToHtml(text) {
  const lines = esc(text).split('\n');
  let html = '';
  let list = false;
  let table = null;
  const closeList = () => list && ((html += '</ul>'), (list = false));
  const closeTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    html += `<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
      .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`;
    table = null;
  };
  for (const raw of lines) {
    const t = raw.trim();
    if (/^\|.*\|$/.test(t)) {
      closeList();
      if (!/^\|[\s:|-]+\|$/.test(t)) (table ||= []).push(t.slice(1, -1).split('|').map((c) => c.trim()));
      continue;
    }
    closeTable();
    const line = inline(raw);
    const li = line.match(/^\s*(?:[-•]|\*(?=\s)|\d+[.)])\s+(.*)/);
    if (li) {
      if (!list) (html += '<ul>'), (list = true);
      html += `<li>${li[1]}</li>`;
      continue;
    }
    closeList();
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) html += `<p class="md-h">${h[1]}</p>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  closeTable();
  closeList();
  return html;
}

export const Markdown = ({ text }) => <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(text) }} />;

/** Número que cuenta hasta su valor (respeta "reducir movimiento"). */
export function CountUp({ value, suffix = '', decimals = 1, signed = false }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const prev = useRef(0);
  useEffect(() => {
    if (value == null) return;
    if (reduce) return setShown(value);
    const c = animate(prev.current, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: setShown });
    prev.current = value;
    return () => c.stop();
  }, [value, reduce]);
  if (value == null) return <span>N/D</span>;
  const n = Math.round(shown * 10 ** decimals) / 10 ** decimals;
  return (
    <span className="num">
      {signed && n > 0 ? '+' : ''}
      {n.toLocaleString('es', { maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

const SEV_KEY = { alta: 'critico', media: 'alto', baja: 'medio' };
const RISK_KEY = { vigente: 'critico', reducido: 'medio', mitigado: 'bajo' };
const INIT_KEY = { pendiente: 'nd', en_progreso: 'medio', completada: 'bajo' };

export const StatusChip = ({ status, long = false }) => <span className={`chip ${STATUS[status].key}`}>{long ? STATUS[status].long : STATUS[status].label}</span>;
export const SeverityChip = ({ s }) => <span className={`chip ${SEV_KEY[s] || 'nd'}`}>{SEVERITY[s] || s}</span>;
export const RiskChip = ({ s }) => <span className={`chip ${RISK_KEY[s]}`}>{RISK_STATE[s]}</span>;
export const InitChip = ({ p }) => (
  <span className={`chip ${INIT_KEY[p.state]}`}>
    {INIT_STATE[p.state]} · {fmt(p.pct)}%
  </span>
);

export const refText = (e) => `${e.document}${e.ref ? `, ${e.ref}` : ''}`;

/** Íconos de línea (sin emoji). */
export function Icon({ name, size = 18 }) {
  const p = {
    chat: 'M4 5h16v11H8l-4 4z',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
    paste: 'M9 4h6v3H9zM6 6h12v15H6z',
    trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
    clip: 'M15 7l-6 6a2 2 0 0 0 3 3l7-7a4 4 0 0 0-6-6l-7 7a6 6 0 0 0 9 9l5-5',
    spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
    check: 'M5 12l5 5 9-10',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    back: 'M19 12H5M11 6l-6 6 6 6',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    restore: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
    swap: 'M7 7h12l-3-3M17 17H5l3 3',
  }[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={p} />
    </svg>
  );
}
