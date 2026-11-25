// Genera los PDF de ejemplo (PDF 1: contexto empresarial, PDF 2: avance de iniciativas) a partir de los
// Markdown de samples/, con una sección por página para que la evidencia pueda citar "p. N".
// Uso: npm run samples
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../src/browser.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function mdToHtml(md) {
  return md
    .split('\n')
    .map((l) => {
      const h = l.match(/^(#{1,3})\s+(.+)$/);
      if (h) return `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`;
      return l.trim() ? `<p>${esc(l)}</p>` : '';
    })
    .join('\n');
}

const jobs = [
  ['samples/empresa-demo.md', 'samples/PDF1-contexto-empresarial.pdf'],
  ['samples/avance-iniciativas.md', 'samples/PDF2-avance-iniciativas.pdf'],
];

const { browser, close } = await launchBrowser();
for (const [src, out] of jobs) {
  const page = await browser.newPage();
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
      body{font:12pt/1.5 Arial,sans-serif;color:#111} h1{font-size:18pt} h2{font-size:14pt;break-before:page}
      h1 + p + p + h2, h1 + p + h2 {break-before:auto} p{margin:0 0 6pt}
    </style>${mdToHtml(fs.readFileSync(src, 'utf8'))}`
  );
  await page.pdf({ path: out, format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' } });
  console.log('generado', path.basename(out));
}
await close();
