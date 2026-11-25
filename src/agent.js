// SalamiOne: evalúa la documentación contra CIS Controls v8.1 (IG objetivo) con el proveedor de IA que
// conecte cada usuario (OpenAI, Claude, Gemini, Ollama o compatible), siguiendo config/prompt-maestro.md.
// Anti-invención en tres capas:
//   1. Los esquemas JSON limitan ids, estados y documentos a listas cerradas (enum).
//   2. El prompt maestro (R1–R12) prohíbe inferir sin cita textual.
//   3. src/verify.js comprueba cada cita contra el texto real y degrada lo que no se puede sostener.
// Sin IA (o si el proveedor falla por saldo, clave, red o modelo) se usa el motor demo de reglas.
import fs from 'node:fs';
import path from 'node:path';
import { fmt, STATUS_IDS } from '../public/scoring.js';
import { CONTEXT_DIMENSIONS } from './verify.js';
import { describeError } from './ai/index.js';

const MAX_CHARS = Number(process.env.MAX_DOC_CHARS || 150000);
// Tamaño de lote al evaluar salvaguardas: mantiene la salida dentro del límite de cualquier modelo.
const BATCH = Number(process.env.SAFEGUARD_BATCH || 40);
export const AGENT_NAME = 'SalamiOne';
export const MASTER_PROMPT_FILE = path.resolve('config/prompt-maestro.md');
export const masterPrompt = () => fs.readFileSync(MASTER_PROMPT_FILE, 'utf8');

// ---------- respaldo ----------

/**
 * Ejecuta con IA y, si el proveedor no está disponible, con el motor demo.
 * Devuelve el resultado con { engine, warning } y llama a onError(mensaje) para que la página avise.
 */
async function withFallback(ai, callLLM, callHeuristic, onError) {
  if (!ai) return { ...(await callHeuristic(null)), engine: 'motor demo (sin IA conectada)' };
  try {
    const out = await callLLM();
    onError?.(null);
    return { ...out, engine: ai.label };
  } catch (e) {
    const d = describeError(e, ai);
    console.error(`[IA ${ai.provider}] ${e?.status || ''} ${d.message}`);
    if (!d.fallback) throw Object.assign(new Error(d.message), { status: 502 });
    onError?.(d.message);
    return { ...(await callHeuristic(d.message)), engine: 'motor demo (respaldo: IA no disponible)', warning: d.message };
  }
}

const heur = () => import('./heuristic.js');

// ---------- utilidades ----------

export function buildCorpus(documents, maxChars = MAX_CHARS) {
  const perDoc = Math.max(2000, Math.floor(maxChars / Math.max(1, documents.length)));
  let truncated = false;
  const body = documents
    .map((d) => {
      let t = d.text;
      if (t.length > perDoc) {
        t = t.slice(0, perDoc) + '\n[... documento truncado ...]';
        truncated = true;
      }
      return `<<<DOCUMENTO: ${d.name}>>>\n${t}\n<<<FIN: ${d.name}>>>`;
    })
    .join('\n\n');
  return { body, truncated };
}

export const catalogText = (catalog, ids = null) =>
  catalog.controls
    .map((c) => {
      const list = c.safeguards.filter((id) => !ids || ids.includes(id));
      if (!list.length) return '';
      return (
        `CONTROL ${c.id}. ${c.name}\n` +
        list
          .map((id) => {
            const s = catalog.safeguards.find((x) => x.id === id);
            return `  ${s.id} [IG${s.ig}] — ${s.title}: ${s.description}`;
          })
          .join('\n')
      );
    })
    .filter(Boolean)
    .join('\n');

// Esquemas JSON (salida estructurada estricta)
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const str = (description) => ({ type: 'string', description });
const arr = (items, description) => ({ type: 'array', items, description });
const enm = (values, description) => ({ type: 'string', enum: values, ...(description ? { description } : {}) });
const evidenceSchema = (documents) =>
  arr(obj({ document: enm(documents.map((d) => d.name)), quote: str('Fragmento copiado literalmente del documento, máximo 300 caracteres') }), 'Citas textuales');

const system = (catalog, extra, ids = null) => `${masterPrompt()}\n\nIG OBJETIVO DE ESTA EVALUACIÓN: IG${catalog.ig} (${catalog.safeguards.length} salvaguardas).\n\n${extra}\n\nCATÁLOGO (${catalog.title}):\n${catalogText(catalog, ids)}`;

/** Divide las salvaguardas en lotes sin partir controles (salvo controles más grandes que el lote). */
export function batches(catalog, size = BATCH) {
  const out = [];
  let cur = [];
  for (const c of catalog.controls) {
    if (cur.length && cur.length + c.safeguards.length > size) {
      out.push(cur);
      cur = [];
    }
    cur.push(...c.safeguards);
  }
  if (cur.length) out.push(cur);
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

// ---------- Etapa 2: ficha de contexto ----------

export async function analyzeContext(ai, documents, catalog, onError) {
  const { body } = buildCorpus(documents);
  return withFallback(
    ai,
    async () => {
      const schema = obj({
        company: obj({ name: str('Nombre copiado textualmente, o vacío'), sector: str('Sector copiado textualmente, o vacío') }),
        dimensions: arr(
          obj({
            id: enm(Object.keys(CONTEXT_DIMENSIONS)),
            findings: arr(obj({ statement: str('Afirmación breve sobre la organización'), evidence: evidenceSchema(documents) }), 'Afirmaciones respaldadas'),
            missing: arr(str(''), 'Información que falta o es ambigua para esta dimensión'),
          }),
          'Una entrada por cada dimensión'
        ),
      });
      const raw = await ai.structured({
        system: system(
          catalog,
          `TAREA (regla R1): construye la ficha de contexto de la organización ANTES de evaluar salvaguardas.
Dimensiones: ${Object.entries(CONTEXT_DIMENSIONS).map(([k, v]) => `${k} (${v})`).join(', ')}.
Cada afirmación debe tener al menos una cita textual. Distingue servicios cloud contratados de infraestructura propia. No supongas herramientas que no aparecen. En "restricciones" lista la información faltante, contradicciones o ambigüedades.`,
          []
        ),
        user: `Documentación:\n\n${body}`,
        name: 'ficha_contexto',
        schema,
      });
      return { raw };
    },
    async (reason) => {
      const h = await heur();
      return { raw: { ...h.heuristicContext(documents), company: h.heuristicAnalysis(documents, catalog).company }, warning: reason };
    },
    onError
  );
}

// ---------- Etapa 3: evaluación de salvaguardas (por lotes) ----------

export async function analyzeSafeguards(ai, documents, catalog, context, onError) {
  const { body, truncated } = buildCorpus(documents);
  return withFallback(
    ai,
    async () => {
      const parts = await mapLimit(batches(catalog), 2, async (ids) => {
        const schema = obj({
          safeguards: arr(
            obj({
              id: enm(ids),
              applicability: enm(['aplica', 'no_aplica', 'por_determinar']),
              status: enm(STATUS_IDS),
              rationale: str('Justificación basada SOLO en las citas'),
              observations: str('Brecha, limitación o información pendiente'),
              evidence: evidenceSchema(documents),
            }),
            `Exactamente una entrada por cada una de estas ${ids.length} salvaguardas: ${ids.join(', ')}`
          ),
        });
        const raw = await ai.structured({
          system: system(
            catalog,
            `TAREA: considerando exclusivamente el contexto de la organización y el catálogo, evalúa estas ${ids.length} salvaguardas (de las ${catalog.safeguards.length} del IG${catalog.ig}): ${ids.join(', ')}.
Para cada una indica aplicabilidad, estado, justificación, observaciones y citas. Cuando no exista información suficiente, usa "no_verificado". No inventes evidencias.
"no_aplicable" solo con una cita que justifique la exclusión. "no_implementado" solo con una cita que confirme la ausencia (R8).

FICHA DE CONTEXTO VALIDADA:
${JSON.stringify(context)}`,
            ids
          ),
          user: `Documentación:\n\n${body}`,
          name: 'evaluacion_cis',
          schema,
        });
        return raw.safeguards || [];
      });
      return { raw: { safeguards: parts.flat() }, truncated };
    },
    async (reason) => ({ raw: (await heur()).heuristicAnalysis(documents, catalog), warning: reason }),
    onError
  );
}

// ---------- Etapa 4: riesgos y roadmap ----------

export async function analyzeRoadmap(ai, assessments, catalog, context, onError) {
  return withFallback(
    ai,
    async () => {
      const ids = catalog.safeguards.map((s) => s.id);
      const schema = obj({
        risks: arr(
          obj({
            id: str('R1..R5'),
            title: str(''),
            description: str(''),
            asset: str('Activo o proceso afectado'),
            deficiency: str('Deficiencia asociada (salvaguardas con brecha)'),
            consequence: str('Consecuencia probable'),
            severity: enm(['alta', 'media', 'baja']),
            justification: str(''),
            safeguards: arr(enm(ids), 'Salvaguardas con brecha relacionadas'),
          }),
          'Exactamente cinco riesgos'
        ),
        initiatives: arr(
          obj({
            name: str(''),
            description: str(''),
            risks: arr(str('id de riesgo, p. ej. R1'), ''),
            safeguards: arr(enm(ids), ''),
            benefit: str('Beneficio esperado'),
            effort: enm(['bajo', 'medio', 'alto']),
            priority: { type: 'integer', description: '1 = primero' },
            type: enm(['quick_win', 'proyecto']),
          }),
          'Exactamente cinco iniciativas'
        ),
      });
      const matrix = Object.entries(assessments).map(([id, a]) => ({ id, estado: a.status, justificacion: a.rationale }));
      const raw = await ai.structured({
        system: system(
          catalog,
          `TAREA: a partir de la matriz verificada, identifica los cinco riesgos principales y un roadmap de cinco iniciativas.
Cada riesgo debe vincularse a salvaguardas con brecha (no implementadas o parciales). No uses salvaguardas no verificadas como si fueran incumplimientos.
Quick win = menor esfuerzo y beneficio inmediato; proyecto = mayor esfuerzo, coordinación o recursos.

FICHA DE CONTEXTO:
${JSON.stringify(context)}

MATRIZ:
${JSON.stringify(matrix)}`
        ),
        user: 'Genera los riesgos y el roadmap.',
        name: 'riesgos_roadmap',
        schema,
      });
      return { raw };
    },
    async () => ({ raw: (await heur()).heuristicRoadmap(assessments, catalog) }),
    onError
  );
}

// ---------- Etapa 5: propuesta de actualización con nueva evidencia ----------

export async function proposeUpdate(ai, newDocs, assessments, catalog, previous, onError) {
  const { body } = buildCorpus(newDocs);
  return withFallback(
    ai,
    async () => {
      const ids = catalog.safeguards.map((s) => s.id);
      const schema = obj({
        initiatives: arr(
          obj({
            name: str('Iniciativa reportada'),
            improved: str('Qué mejoró'),
            safeguards: arr(enm(ids), 'Salvaguardas relacionadas con el cambio'),
            evidence: evidenceSchema(newDocs),
            completeness: enm(['completa', 'parcial']),
            pending: str('Condiciones que siguen pendientes'),
          }),
          'Una entrada por iniciativa reportada en el documento'
        ),
        changes: arr(
          obj({
            id: enm(ids),
            proposed: enm(STATUS_IDS),
            justification: str('Por qué se justifica (o no) el cambio'),
            pending: str('Qué falta para un estado mejor'),
            evidence: evidenceSchema(newDocs),
          }),
          'Solo salvaguardas afectadas por la nueva evidencia'
        ),
      });
      const raw = await ai.structured({
        system: system(
          catalog,
          `TAREA (reglas R10–R12): procesa la NUEVA EVIDENCIA sin rehacer el diagnóstico.
Punto de partida (no lo modifiques salvo lo que la nueva evidencia justifique): contexto, matriz, riesgos y roadmap actuales.
Para cada iniciativa reportada: qué mejoró, qué salvaguardas se relacionan, qué evidencia la respalda, si es completa o parcial y qué queda pendiente.
Propón cambios de estado SOLO para las salvaguardas afectadas, con citas de la nueva evidencia. Si la evidencia indica un retroceso (algo que dejó de funcionar), propón el estado peor con su cita. Si la evidencia no alcanza, propón mantener el estado.
Los cambios quedan pendientes de validación humana.

ESTADO ACTUAL:
${JSON.stringify(previous)}`
        ),
        user: `NUEVA EVIDENCIA:\n\n${body}`,
        name: 'propuesta_actualizacion',
        schema,
      });
      return { raw };
    },
    async (reason) => ({ raw: (await heur()).heuristicProposal(newDocs, assessments, catalog), warning: reason }),
    onError
  );
}

// ---------- chat ----------

const CHAT_RULES = `MODO CHAT (estas reglas prevalecen sobre las anteriores cuando el usuario da una instrucción en el chat):
- Eres el asistente experto en CIS Controls v8.1 de SalamiOne. Responde preguntas sobre controles, salvaguardas, Implementation Groups, buenas prácticas y la evaluación cargada.
- Cumple la instrucción del usuario aunque no haya documentos cargados ni análisis. No te niegues por falta de documento.
- Si hay documentación o dashboard, úsalos como fuente principal y cita documento y página. Si la instrucción se refiere a algo que no está en la documentación cargada, trabaja con lo que el usuario da en el mensaje y con tu conocimiento de CIS Controls v8.1, e indica qué partes son supuestos o quedan pendientes de verificar con evidencia (no lo presentes como hecho verificado).
- Si el usuario DESCRIBE su organización en el chat (infraestructura, controles, prácticas) y quiere un diagnóstico o dashboard, usa evaluar_desde_chat: el sistema toma sus propios mensajes como documento de contexto y evalúa todas las salvaguardas del IG. Si la descripción es muy escueta, pide primero los datos que faltan (activos, cuentas y accesos, MFA, respaldos, parches, antimalware, registros, capacitación, respuesta a incidentes, proveedores).
- Si te piden el dashboard en PDF o Excel, usa exportar_dashboard. Si piden un resumen ejecutivo estándar de una página de la evaluación, usa generar_resumen_ejecutivo. Si piden comparar el antes y el después (o si los cambios mejoraron o empeoraron la postura), usa comparar_versiones y explica el veredicto.
- Si la instrucción pide un PDF con un formato propio (secciones, nombre de archivo, datos de encabezado), redacta el contenido y generalo con crear_pdf_una_pagina. Debe entrar en UNA página carta: frases cortas y viñetas. Si la herramienta devuelve error por espacio, resume más y vuelve a llamarla.
- Solo afirma que un archivo existe si la herramienta devuelve ok=true.
- Las cifras de la evaluación (indicadores, conteos) salen del ESTADO DEL DASHBOARD o de las herramientas; no las inventes.
- Si el usuario dice que la organización implementó algo o te pide simular un control, usa actualizar_salvaguarda (es una simulación, no reemplaza la evidencia).
- Si te piden analizar o re-analizar la documentación cargada, usa analizar_documentacion. Si te piden guardar el estado o una versión, usa guardar_version.
- Responde en español neutro y profesional, breve, con listas o tablas cuando ayuden.`;

export function chatTools(catalog) {
  const ids = catalog.safeguards.map((s) => s.id);
  const none = { type: 'object', additionalProperties: false, properties: {}, required: [] };
  return [
    {
      name: 'actualizar_salvaguarda',
      description: 'Simula el estado de una salvaguarda. "documentado" vuelve al estado que surge de la evidencia.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'estado'],
        properties: { id: { type: 'string', enum: ids }, estado: { type: 'string', enum: ['implementado', 'parcial', 'no_implementado', 'documentado'] } },
      },
    },
    { name: 'analizar_documentacion', description: `Evalúa (o re-evalúa) los documentos de contexto cargados: contexto, ${ids.length} salvaguardas, riesgos y roadmap. Arma el dashboard.`, parameters: none },
    {
      name: 'evaluar_desde_chat',
      description:
        'Arma el dashboard a partir de lo que el usuario describió en esta conversación: guarda sus mensajes como documento de contexto y evalúa todas las salvaguardas del IG con citas de esos mensajes.',
      parameters: { type: 'object', additionalProperties: false, required: ['titulo'], properties: { titulo: { type: 'string', description: 'Nombre corto del documento, p. ej. "Descripción de Acme en el chat"' } } },
    },
    {
      name: 'exportar_dashboard',
      description: 'Genera el enlace de descarga del dashboard completo en PDF o en Excel (.xlsx con hojas de resumen, controles, salvaguardas, riesgos y roadmap).',
      parameters: { type: 'object', additionalProperties: false, required: ['formato'], properties: { formato: { type: 'string', enum: ['pdf', 'excel'] } } },
    },
    { name: 'generar_resumen_ejecutivo', description: 'Genera el resumen ejecutivo estándar de UNA página (PDF carta) de la evaluación actual y lo ofrece para descargar.', parameters: none },
    {
      name: 'comparar_versiones',
      description:
        'Compara dos versiones del diagnóstico (por defecto, la evaluación inicial contra el estado actual) y devuelve el veredicto (mejoró, empeoró, mixto o sin cambios), variaciones de indicadores, salvaguardas que mejoraron o retrocedieron y enlaces de descarga.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['version_a', 'version_b'],
        properties: {
          version_a: { type: 'string', description: 'Número de versión de referencia (p. ej. "1"), o "inicial"' },
          version_b: { type: 'string', description: 'Número de versión comparada, o "actual"' },
        },
      },
    },
    {
      name: 'crear_pdf_una_pagina',
      description:
        'Genera un archivo PDF real de UNA página (carta, vertical) con el contenido que le pases y lo ofrece para descargar. Úsala cuando el usuario pida un PDF con un formato propio. Devuelve ok=true con el nombre del archivo, u ok=false con el motivo (por ejemplo, si no entra en una página).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['nombre_archivo', 'titulo', 'subtitulo', 'datos', 'secciones', 'pie'],
        properties: {
          nombre_archivo: { type: 'string', description: 'Nombre del archivo pedido (con o sin .pdf)' },
          titulo: { type: 'string', description: 'Título principal' },
          subtitulo: { type: 'string', description: 'Subtítulo; cadena vacía si no hace falta' },
          datos: {
            type: 'array',
            description: 'Datos de identificación del encabezado (empresa, fecha, versión, alcance, etc.)',
            items: { type: 'object', additionalProperties: false, required: ['etiqueta', 'valor'], properties: { etiqueta: { type: 'string' }, valor: { type: 'string' } } },
          },
          secciones: {
            type: 'array',
            description: 'Secciones en el orden pedido. contenido admite párrafos, viñetas "- ", listas "1. ", **negrita** y tablas Markdown.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['titulo', 'contenido', 'destacada'],
              properties: { titulo: { type: 'string' }, contenido: { type: 'string' }, destacada: { type: 'boolean', description: 'true para resaltar (p. ej. la conclusión)' } },
            },
          },
          pie: { type: 'string', description: 'Nota al pie: fuentes, supuestos o limitaciones; cadena vacía para el pie por defecto' },
        },
      },
    },
    {
      name: 'guardar_version',
      description: 'Guarda una versión del diagnóstico actual para compararla después.',
      parameters: { type: 'object', additionalProperties: false, required: ['nombre'], properties: { nombre: { type: 'string' } } },
    },
  ];
}

export function dashboardSummary(d, proposal) {
  if (!d) return 'Todavía no hay análisis: el dashboard está vacío.';
  return JSON.stringify({
    organizacion: d.company,
    marco: d.shortName,
    indicadores: { implementacion: d.implementation, cobertura: d.coverage, evaluables: d.evaluable, total: d.total, conteo: d.counts },
    contexto: d.context,
    riesgos: d.risks.map((r) => ({ id: r.id, titulo: r.title, severidad: r.severity, estado: r.state, salvaguardas: r.safeguards })),
    iniciativas: d.initiatives.map((i) => ({ id: i.id, nombre: i.name, tipo: i.type, esfuerzo: i.effort, avance: i.progress })),
    salvaguardas: d.safeguards.map((s) => ({
      id: s.id,
      estado: s.status,
      segunEvidencia: s.documented,
      justificacion: s.rationale,
      evidencia: s.evidence.slice(0, 2).map((e) => `"${e.quote}" (${e.document}${e.ref ? `, ${e.ref}` : ''})`),
    })),
    propuestaPendiente: proposal ? proposal.changes.filter((c) => c.decision === 'pendiente').map((c) => ({ id: c.id, de: c.from, a: c.proposed })) : null,
  });
}

/**
 * ctx: { ai, documents, catalog, dashboard(), proposal(), versions, tools: {nombre: async fn(args)}, onError }
 * Devuelve { reply, actions }.
 */
export async function chat(messages, ctx) {
  const { body } = buildCorpus(ctx.documents, Math.min(MAX_CHARS, 80000));
  const versions = (ctx.versions || []).map((v) => `v${v.n} · ${v.label} · implementación ${v.summary.implementation ?? 'N/D'}%`).join('\n');
  const sys =
    `${system(ctx.catalog, CHAT_RULES)}\n\nESTADO DEL DASHBOARD:\n${dashboardSummary(ctx.dashboard(), ctx.proposal?.())}` +
    `\n\nVERSIONES GUARDADAS:\n${versions || '(ninguna)'}\n\nDOCUMENTACIÓN:\n${body || '(no hay documentos cargados)'}`;
  const history = messages.slice(-20).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 12000) }));
  const actions = [];
  const runTool = async (name, args) => {
    try {
      const fn = ctx.tools[name];
      if (!fn) throw new Error(`Herramienta desconocida: ${name}`);
      const out = await fn(typeof args === 'string' ? JSON.parse(args || '{}') : args || {});
      if (out.action) actions.push(out.action);
      return out;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  const out = await withFallback(
    ctx.ai,
    async () => ({ reply: await ctx.ai.chat({ system: sys, messages: history, tools: chatTools(ctx.catalog), runTool }) }),
    async (reason) => {
      const reply = (await heur()).heuristicChat(messages, ctx.dashboard(), ctx.catalog);
      return { reply: reason ? `⚠️ ${reason}\n\nMientras tanto respondo en modo demo:\n\n${reply}` : reply };
    },
    ctx.onError
  );
  return { reply: out.reply, actions, engine: out.engine };
}

export { fmt };
