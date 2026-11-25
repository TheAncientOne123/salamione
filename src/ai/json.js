// Utilidades para obtener JSON de modelos que no garantizan salida estructurada.

/** Parsea JSON tolerando bloques ```json y texto alrededor. Lanza SyntaxError si no hay JSON válido. */
export function parseJsonLoose(text) {
  const t = String(text || '').trim();
  try {
    return JSON.parse(t);
  } catch {}
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new SyntaxError('El modelo no devolvió JSON válido.');
}

export const schemaInstruction = (schema) =>
  `FORMATO DE RESPUESTA: respondé ÚNICAMENTE con un objeto JSON válido (sin texto adicional ni bloques de código) que cumpla exactamente este JSON Schema. Usá solo los valores permitidos en cada "enum".\n${JSON.stringify(schema)}`;
