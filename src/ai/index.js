// Registro de proveedores de IA. Cada usuario conecta el suyo (API key cifrada en la base) o usa el del servidor.
import { createOpenAICompatible, listOpenAICompatibleModels } from './openai-compatible.js';
import { createAnthropic, listAnthropicModels, ANTHROPIC_DEFAULT_MODEL } from './anthropic.js';

export const PROVIDERS = {
  openai: { label: 'OpenAI', needsKey: true, defaultModel: 'gpt-4.1', keyUrl: 'https://platform.openai.com/api-keys', hint: 'Clave que empieza con sk-…' },
  anthropic: { label: 'Anthropic (Claude)', needsKey: true, defaultModel: ANTHROPIC_DEFAULT_MODEL, keyUrl: 'https://console.anthropic.com/settings/keys', hint: 'Clave que empieza con sk-ant-…' },
  gemini: {
    label: 'Google Gemini',
    needsKey: true,
    defaultModel: 'gemini-2.5-pro',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyUrl: 'https://aistudio.google.com/apikey',
    hint: 'Clave de Google AI Studio',
  },
  ollama: { label: 'Ollama (local)', needsKey: false, defaultModel: 'llama3.1', baseURL: 'http://localhost:11434/v1', hint: 'Sin clave. Ollama debe estar corriendo en tu equipo o servidor.' },
  compatible: { label: 'Compatible con OpenAI', needsKey: false, defaultModel: '', baseURL: '', hint: 'LM Studio, OpenRouter, Azure OpenAI, vLLM, LocalAI… Indica la URL base /v1.' },
};

/** Completa la URL base por defecto del proveedor. */
export function resolveConfig(cfg) {
  if (!cfg?.provider || !PROVIDERS[cfg.provider]) return null;
  const p = PROVIDERS[cfg.provider];
  return { ...cfg, baseURL: cfg.baseURL || p.baseURL || undefined, model: cfg.model || p.defaultModel };
}

/**
 * Crea el cliente de IA, o null si no hay configuración utilizable (se usa el motor demo).
 * opts.timeoutMs y opts.maxRetries limitan cuánto se espera al proveedor.
 */
export function createAI(cfg, opts = {}) {
  const c = resolveConfig(cfg && { ...cfg, ...opts });
  if (!c || !c.model) return null;
  if (PROVIDERS[c.provider].needsKey && !c.apiKey) return null;
  const ai = c.provider === 'anthropic' ? createAnthropic(c) : createOpenAICompatible(c);
  ai.label = `${PROVIDERS[c.provider].label} · ${ai.model}`;
  ai.source = cfg.source || 'usuario';
  return ai;
}

export async function listModels(cfg, opts = { timeoutMs: 20000, maxRetries: 0 }) {
  const c = resolveConfig(cfg && { ...cfg, ...opts });
  if (!c) throw Object.assign(new Error('Proveedor desconocido.'), { status: 400 });
  const ids = c.provider === 'anthropic' ? await listAnthropicModels(c) : await listOpenAICompatibleModels(c);
  return rankModels(c.provider, ids);
}

/** Traduce errores de cualquier proveedor a un mensaje claro y decide si se pasa al modo demo. */
export function describeError(e, ai) {
  const name = ai ? PROVIDERS[ai.provider]?.label || ai.provider : 'el proveedor de IA';
  const status = e?.status;
  const text = `${e?.message || ''} ${e?.error?.message || ''} ${e?.code || ''} ${e?.type || ''} ${e?.error?.type || ''}`;
  if (status === 429 && /quota|credit|billing|insufficient/i.test(text)) return { fallback: true, message: `La cuenta de ${name} no tiene saldo o superó su cuota.` };
  if (status === 429) return { fallback: true, message: `${name} está limitando las solicitudes (rate limit). Prueba de nuevo en unos segundos.` };
  if (status === 401) return { fallback: true, message: `La API key de ${name} es inválida o fue revocada. Revísala en Configuración de IA.` };
  if (status === 403) return { fallback: true, message: `La API key no tiene permiso para usar este modelo en ${name}.` };
  if (status === 404) return { fallback: true, message: `El modelo "${ai?.model}" no está disponible en ${name}. Elige otro en Configuración de IA.` };
  if (status === 529 || status === 503 || status === 502) return { fallback: true, message: `${name} está saturado o no disponible en este momento.` };
  if (status === 413 && e?.truncatedOutput) return { fallback: true, message: `${e.message} Prueba con un modelo con más capacidad de salida.` };
  if (!status && /ECONNREFUSED|ENOTFOUND|fetch failed|Connection error|ETIMEDOUT|socket/i.test(text)) {
    return { fallback: true, message: `No se pudo conectar con ${name}${ai?.provider === 'ollama' ? ' (¿Ollama está corriendo?)' : ''}. Revisa la red o la URL base.` };
  }
  if (e?.code === 'TIMEOUT' || /timed? ?out|timeout/i.test(text) || e?.name === 'APIConnectionTimeoutError') {
    return {
      fallback: true,
      message:
        ai?.provider === 'ollama'
          ? `Ollama no respondió a tiempo. Si es la primera vez que usas "${ai.model}", puede estar cargándose en memoria: espera un momento y vuelve a probar.`
          : `${name} no respondió a tiempo. Revisa la URL base o prueba con un modelo más rápido.`,
    };
  }
  // El endpoint de Gemini compatible con OpenAI responde 400 sin cuerpo cuando la clave no es válida.
  if (ai?.provider === 'gemini' && [400, 403].includes(status) && !/schema|format|json/i.test(text)) {
    return { fallback: true, message: `Google Gemini rechazó la solicitud: revisa que la API key de AI Studio sea válida y que el modelo "${ai.model}" exista (usa "Cargar modelos disponibles").` };
  }
  if (status === 400 && !e?.message?.replace(/^\d+ status code \(no body\)$/, '')) {
    return { fallback: true, message: `${name} rechazó la solicitud (400) sin dar detalles. Revisa la API key, la URL base y el modelo.` };
  }
  if (e instanceof SyntaxError) return { fallback: true, message: `${name} devolvió una respuesta que no es JSON válido; se usó el motor de respaldo.` };
  return { fallback: false, message: e?.message || `Error desconocido de ${name}.` };
}

// ---------- elección de modelo y prueba de conexión ----------

// Orden de preferencia para recomendar un modelo de texto (de la familia más conveniente a la menos).
// En Gemini se prefieren los alias "-latest" (siempre apuntan a la versión vigente) y las versiones estables a las preview.
const PREFERRED = {
  gemini: [/^gemini-flash-latest$/, /^gemini-[\d.]+-flash$/, /^gemini-pro-latest$/, /^gemini-[\d.]+-pro$/, /^gemini-flash-lite-latest$/, /^gemini-[\d.]+-flash-lite$/, /^gemini-[\d.]+-(flash|pro)(-preview)?/, /^gemini/],
  openai: [/^gpt-4\.1$/, /^gpt-[\d.]+$/, /^gpt-[\d.]+-mini$/, /^gpt/, /^o\d/],
  anthropic: [/^claude-opus-5-5$/, /^claude-opus/, /^claude-sonnet/, /^claude/],
};
const vnum = (id) => parseFloat((id.match(/(\d+(?:\.\d+)?)/) || [])[1] || 0);
const unstable = (id) => /(preview|exp|-\d{2}-\d{2}$|-\d{4}$)/.test(id);

/** Ordena los modelos: primero los recomendados (por familia preferida, estables y más nuevos), después el resto. */
export function rankModels(provider, models) {
  const rules = PREFERRED[provider];
  if (!rules) return [...models]; // servidores genéricos: se respeta el orden que entregan
  const score = (m) => {
    const k = rules.findIndex((re) => re.test(m));
    return k < 0 ? rules.length : k;
  };
  return [...models].sort((a, b) => score(a) - score(b) || unstable(a) - unstable(b) || vnum(b) - vnum(a) || a.localeCompare(b));
}

/** Modelo recomendado de una lista (o el del proveedor si no hay lista). */
export function recommendModel(provider, models) {
  if (!models?.length) return PROVIDERS[provider]?.defaultModel || '';
  if (provider === 'anthropic' && models.includes(ANTHROPIC_DEFAULT_MODEL)) return ANTHROPIC_DEFAULT_MODEL;
  // En un servidor compatible genérico no se adivina: el usuario elige (puede haber modelos de imagen, audio, etc.).
  if (provider === 'compatible') return '';
  // Ollama solo lista lo que el usuario descargó: se respeta su primer modelo.
  if (!PREFERRED[provider]) return models[0];
  return rankModels(provider, models)[0];
}

/** Si el usuario no escribió modelo, elige uno de los disponibles en su cuenta. */
export async function pickModel(cfg) {
  if (cfg.model) return cfg.model;
  const fixed = PROVIDERS[cfg.provider]?.defaultModel;
  if (cfg.provider === 'openai' || cfg.provider === 'anthropic') return fixed;
  const models = await listModels(cfg);
  if (!models.length) throw Object.assign(new Error('El proveedor no devolvió ningún modelo. Escribe el nombre del modelo a mano.'), { status: 400 });
  return recommendModel(cfg.provider, models);
}

const withDeadline = (promise, ms) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms))]);

/**
 * Prueba de conexión en dos pasos, con tiempo límite total:
 *  1. clave y URL: lista los modelos (rápido) y confirma que el modelo existe;
 *  2. salida estructurada: una respuesta JSON corta con el mismo mecanismo que usa la evaluación.
 * Devuelve { ok, label, model, ms, step } o lanza un error con { step, message }.
 */
export async function testConnection(cfg, { timeoutMs = 45000 } = {}) {
  const t0 = Date.now();
  const left = () => Math.max(5000, timeoutMs - (Date.now() - t0));
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (e) {
      const model = cfg.model || PROVIDERS[cfg.provider]?.defaultModel;
      // La lista de modelos ya respondió (la clave funciona) pero el modelo falla al contestar:
      // el problema es el modelo, no la clave.
      if (name === 'respuesta' && models?.length && [400, 404, 422].includes(e?.status)) {
        const rec = recommendModel(cfg.provider, models);
        throw Object.assign(
          new Error(`La clave funciona, pero el modelo "${model}" no aceptó la solicitud: puede que no admita chat de texto con respuestas JSON.${rec && rec !== model ? ` Prueba con ${rec} (recomendado).` : ''}`),
          { status: 400, step: name, recommended: rec }
        );
      }
      const d = describeError(e, { provider: cfg.provider, model });
      throw Object.assign(new Error(d.message), { status: 400, step: name });
    }
  };
  let models = null;
  await step('modelos', async () => {
    try {
      models = await withDeadline(listModels(cfg, { timeoutMs: Math.min(20000, left()), maxRetries: 0 }), Math.min(22000, left()));
    } catch (e) {
      // Algunos servidores compatibles no exponen /models: no es motivo para fallar si la clave funciona.
      if (cfg.provider === 'compatible' && [404, 405, 501].includes(e?.status)) models = null;
      else throw e;
    }
  });
  const model = cfg.model || (await step('modelos', () => pickModel({ ...cfg })));
  // Los alias (p. ej. gemini-flash-latest) pueden no figurar en la lista aunque funcionan: no se rechazan.
  if (models?.length && !models.includes(model) && cfg.provider !== 'compatible' && !/-latest$/.test(model)) {
    const similar = models.filter((m) => m.split(/[-:]/)[0] === model.split(/[-:]/)[0]).slice(0, 4);
    throw Object.assign(new Error(`El modelo "${model}" no está entre los modelos de texto disponibles en tu cuenta de ${PROVIDERS[cfg.provider].label}.${similar.length ? ` Disponibles: ${similar.join(', ')}.` : ''}`), { status: 400, step: 'modelos', models });
  }
  const ai = createAI({ ...cfg, model }, { timeoutMs: left(), maxRetries: 0 });
  if (!ai) throw Object.assign(new Error('Faltan datos: proveedor, modelo o API key.'), { status: 400, step: 'datos' });
  const answer = await step('respuesta', () =>
    withDeadline(
      ai.structured({
        system: 'Eres un verificador de conexión. Responde solo con el JSON pedido.',
        user: 'Devuelve ok=true y el número de salvaguardas de CIS Controls v8.1 IG1 (56).',
        name: 'prueba',
        maxTokens: 2048,
        schema: { type: 'object', additionalProperties: false, required: ['ok', 'salvaguardas_ig1'], properties: { ok: { type: 'boolean' }, salvaguardas_ig1: { type: 'integer' } } },
      }),
      left()
    )
  );
  if (answer?.ok !== true) throw Object.assign(new Error(`${ai.label} respondió, pero no con el formato esperado. Prueba con otro modelo.`), { status: 400, step: 'respuesta' });
  return { ok: true, label: ai.label, model, ms: Date.now() - t0, models: models || [] };
}
