// Proveedor Anthropic (Claude) con el SDK oficial.
// - Salida estructurada: output_config.format con json_schema; si el modelo o la cuenta no lo admite, JSON pedido en el prompt.
// - Chat: bucle manual de herramientas (tool_use → tool_result en un solo mensaje de usuario).
// - Streaming + finalMessage() para respuestas largas (evaluaciones de hasta 153 salvaguardas).
import Anthropic from '@anthropic-ai/sdk';
import { parseJsonLoose, schemaInstruction } from './json.js';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
// Modelos que admiten el parámetro de respaldo del servidor ante una negativa (refusal).
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const MAX_TOKENS = 64000;

const client = (cfg) => new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL || undefined, maxRetries: cfg.maxRetries ?? 2, timeout: cfg.timeoutMs ?? 10 * 60 * 1000 });
const textOf = (msg) => msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

export function createAnthropic(cfg) {
  const c = client(cfg);
  const model = cfg.model || ANTHROPIC_DEFAULT_MODEL;
  let useFallbacks = FALLBACK_MODELS.has(model);
  let useFormat = true;

  /** Envía un request por streaming. Con modelos recientes agrega el respaldo del servidor ante negativas. */
  async function send(params) {
    const run = (p) => (useFallbacks ? c.beta.messages.stream({ ...p, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }) : c.messages.stream(p)).finalMessage();
    try {
      return await run(params);
    } catch (e) {
      // Cuenta o proxy sin la beta de fallbacks: se reintenta sin ella.
      if (useFallbacks && e?.status === 400 && /fallback|beta/i.test(e?.message || '')) {
        useFallbacks = false;
        return run(params);
      }
      throw e;
    }
  }

  const checkStop = (msg) => {
    if (msg.stop_reason === 'refusal') throw Object.assign(new Error(`Claude no respondió esta solicitud (${msg.stop_details?.category || 'política de uso'}).`), { status: 422 });
    if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('La respuesta de Claude se cortó por longitud.'), { status: 413, truncatedOutput: true });
  };

  return {
    provider: 'anthropic',
    model,

    async structured({ system, user, schema, maxTokens = MAX_TOKENS }) {
      if (useFormat) {
        try {
          const msg = await send({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }], output_config: { format: { type: 'json_schema', schema } } });
          checkStop(msg);
          return JSON.parse(textOf(msg));
        } catch (e) {
          // Solo se abandona la salida estructurada si el error es de formato o esquema (no de clave, modelo o saldo).
          if (e?.status !== 400 || !/output_config|format|schema|json/i.test(e?.message || '')) throw e;
          useFormat = false; // el esquema o el modelo no admiten salida estructurada: se pide JSON en el prompt
        }
      }
      const msg = await send({ model, max_tokens: maxTokens, system: `${system}\n\n${schemaInstruction(schema)}`, messages: [{ role: 'user', content: user }] });
      checkStop(msg);
      return parseJsonLoose(textOf(msg));
    },

    async chat({ system, messages, tools, runTool }) {
      const anthropicTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      // La API exige que el primer mensaje sea del usuario.
      const conv = messages.slice(messages.findIndex((m) => m.role === 'user')).map((m) => ({ role: m.role, content: m.content }));
      for (let step = 0; step < 10; step++) {
        const msg = await send({ model, max_tokens: 16000, system, messages: conv, tools: anthropicTools });
        if (msg.stop_reason === 'refusal') return 'No puedo ayudar con esa solicitud. Reformúlala o consulta sobre la evaluación CIS.';
        // Se agrega el contenido completo (incluye bloques de razonamiento, que deben volver sin cambios).
        conv.push({ role: 'assistant', content: msg.content });
        if (msg.stop_reason === 'pause_turn') continue;
        const uses = msg.content.filter((b) => b.type === 'tool_use');
        if (!uses.length) return textOf(msg);
        const results = [];
        for (const u of uses) {
          const out = await runTool(u.name, u.input);
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), is_error: !!out?.error });
        }
        conv.push({ role: 'user', content: results });
      }
      return 'Listo, apliqué los cambios. Revisa el dashboard.';
    },
  };
}

export async function listAnthropicModels(cfg) {
  const ids = [];
  for await (const m of client(cfg).models.list()) ids.push(m.id);
  return ids;
}

export { Anthropic };
