// PDF de UNA página (carta, vertical) a partir del contenido que redacta el agente en el chat.
// Lo usa la herramienta del chat "crear_pdf_una_pagina": el usuario pide un PDF con cierto formato,
// El modelo arma título, datos de encabezado y secciones, y la página lo imprime y verifica que sea 1 página.
import fs from 'node:fs';
import path from 'node:path';
import { renderOnePager } from './onepager.js';
import { esc } from './components.js';

const read = (p) => fs.readFileSync(path.resolve(p), 'utf8');

/** Markdown simple → HTML: párrafos, viñetas, listas numeradas, **negrita**, *itálica* y tablas. */
export function miniMarkdown(text) {
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(«"])\*(?!\s)([^*]+?)\*(?=[\s.,;:)»"]|$)/g, '$1<i>$2</i>');
  const out = [];
  let list = null;
  let table = null;
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    table = null;
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const t = raw.trim();
    if (/^\|.*\|$/.test(t)) {
      flushList();
      if (!/^\|[\s:|-]+\|$/.test(t)) (table ||= []).push(t.slice(1, -1).split('|').map((c) => c.trim()));
      continue;
    }
    flushTable();
    const ul = t.match(/^[-•*]\s+(.*)/);
    const ol = t.match(/^\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      (list ||= { tag, items: [] }).items.push(inline((ul || ol)[1]));
      continue;
    }
    flushList();
    if (t) out.push(`<p>${inline(t)}</p>`);
  }
  flushList();
  flushTable();
  return out.join('');
}

/** Nombre de archivo seguro y con extensión .pdf. */
export function safePdfName(name, fallback = 'SalamiOne_resumen') {
  const base = String(name || '')
    .trim()
    .replace(/\.pdf$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_.\-\[\]]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return `${base || fallback}.pdf`;
}

/**
 * @param doc { titulo, subtitulo?, datos?: [{etiqueta, valor}], secciones: [{titulo, contenido, destacada?}], pie? }
 */
export function buildSummaryHtml(doc) {
  const secciones = (doc.secciones || [])
    .filter((s) => s && (s.titulo || s.contenido))
    .map(
      (s, i) => `<section class="${s.destacada ? 'destacada' : ''}">
        ${s.titulo ? `<h2><span class="n">${i + 1}</span>${esc(s.titulo)}</h2>` : ''}
        ${miniMarkdown(s.contenido)}
      </section>`
    )
    .join('');
  const datos = (doc.datos || []).filter((d) => d && (d.etiqueta || d.valor));
  const data = {
    titulo: esc(doc.titulo || 'Resumen'),
    css: read('templates/resumen-1p.css'),
    logo: read('web/public/logo.svg'),
    subtitulo: doc.subtitulo ? `<div class="sub">${esc(doc.subtitulo)}</div>` : '',
    datos: datos.length ? `<div class="datos">${datos.map((d) => `<span><b>${esc(d.etiqueta)}:</b> ${esc(d.valor)}</span>`).join('')}</div>` : '',
    secciones,
    pie: esc(doc.pie || `Generado por SalamiOne el ${new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}.`),
  };
  return read('templates/resumen-1p.html').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in data ? data[k] : m));
}

/** Genera el PDF, lo guarda en dir y devuelve { file, pdf, pages }. Falla si no entra en una página. */
export async function createSummaryPdf(doc, dir) {
  const file = safePdfName(doc.nombre_archivo || doc.titulo);
  const { pdf, pages } = await renderOnePager(buildSummaryHtml(doc), { startSize: 11 });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), pdf);
  return { file, pdf, pages };
}
