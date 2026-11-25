import path from 'node:path';
import mammoth from 'mammoth';
// Se importa la librería interna para evitar el "modo debug" de pdf-parse 1.x,
// que intenta leer un PDF de prueba al importarse desde el índice.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export const SUPPORTED = ['.pdf', '.docx', '.txt', '.md', '.csv', '.json', '.log', '.html', '.htm'];

export async function extractText(buffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (!SUPPORTED.includes(ext)) {
    throw new Error(`Formato no soportado (${ext}). Usá: ${SUPPORTED.join(', ')}`);
  }
  let text;
  if (ext === '.pdf') {
    // Marcamos cada página para poder citar "p. N" en la evidencia (página o sección del PDF).
    let n = 0;
    const pagerender = (page) =>
      page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((tc) => {
        let lastY;
        let out = '';
        for (const item of tc.items) {
          out += lastY === item.transform[5] || lastY === undefined ? item.str : '\n' + item.str;
          lastY = item.transform[5];
        }
        return `[[Página ${++n}]]\n${out}`;
      });
    text = (await pdfParse(buffer, { pagerender })).text;
  } else if (ext === '.docx') {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (ext === '.html' || ext === '.htm') {
    text = buffer
      .toString('utf8')
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  } else {
    text = buffer.toString('utf8');
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!text.replace(/\[\[Página \d+\]\]/g, '').trim()) throw new Error('No se pudo extraer texto (¿PDF escaneado sin OCR?).');
  return text;
}
