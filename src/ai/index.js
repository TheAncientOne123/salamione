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

/** Crea el cliente de IA, o null si no hay configuración utilizable (se usa el motor demo). */
export function createAI(cfg) {
  const c = resolveConfig(cfg);
  if (!c || !c.model) return null;
  if (PROVIDERS[c.provider].needsKey && !c.apiKey) return null;
  const ai = c.provider === 'anthropic' ? createAnthropic(c) : createOpenAICompatible(c);
  ai.label = `${PROVIDERS[c.provider].label} · ${ai.model}`;
  ai.source = cfg.source || 'usuario';
  return ai;
}

export async function listModels(cfg) {
  const c = resolveConfig(cfg);
  if (!c) throw Object.assign(new Error('Proveedor desconocido.'), { status: 400 });
  return c.provider === 'anthropic' ? listAnthropicModels(c) : listOpenAICompatibleModels(c);
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
  if (e instanceof SyntaxError) return { fallback: true, message: `${name} devolvió una respuesta que no es JSON válido; se usó el motor de respaldo.` };
  return { fallback: false, message: e?.message || `Error desconocido de ${name}.` };
}
