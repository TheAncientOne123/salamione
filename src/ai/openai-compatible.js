// Proveedores con API compatible con OpenAI: OpenAI, Google Gemini (endpoint OpenAI), Ollama, LM Studio,
// OpenRouter, Azure, vLLM… Salida estructurada con json_schema estricto y, si el servidor no lo soporta,
// se degrada a json_object y finalmente a JSON pedido en el prompt (el verificador valida igual el resultado).
import OpenAI from 'openai';
import { parseJsonLoose, schemaInstruction } from './json.js';

// Tiempo máximo por solicitud y reintentos: los define quien crea el cliente (la prueba de conexión usa valores cortos).
export function openaiClient(cfg) {
  return new OpenAI({ apiKey: cfg.apiKey || 'sin-clave', baseURL: cfg.baseURL || undefined, maxRetries: cfg.maxRetries ?? 1, timeout: cfg.timeoutMs ?? 5 * 60 * 1000 });
}

// Solo un error que habla del formato de salida justifica probar el siguiente formato; uno de clave o de modelo no.
const unsupportedFormat = (e) =>
  [400, 422, 501].includes(e?.status) && /response_format|json_schema|json_object|schema|structured|format|strict|additionalProperties/i.test(`${e?.message || ''} ${e?.error?.message || ''}`);
// Algunos modelos de OpenAI no aceptan herramientas en Chat Completions y exigen la Responses API.
const needsResponsesApi = (e) => e?.status === 400 && /(\/v1\/responses|reasoning_effort)/i.test(e?.error?.message || e?.message || '');

export function createOpenAICompatible(cfg) {
  const client = openaiClient(cfg);
  const model = cfg.model;
  // Modo de salida estructurada que funcionó la última vez para este modelo.
  let mode = 'json_schema';
  let usesResponses = false;

  async function complete(system, user, name, schema, format, maxTokens) {
    const sys = format === 'json_schema' ? system : `${system}\n\n${schemaInstruction(schema)}`;
    const body = { model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] };
    if (format === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name, strict: true, schema } };
    if (format === 'json_object') body.response_format = { type: 'json_object' };
    if (maxTokens && cfg.provider !== 'openai') body.max_tokens = maxTokens;
    const res = await client.chat.completions.create(body);
    const msg = res.choices[0].message;
    if (msg.refusal) throw Object.assign(new Error(`El modelo se negó: ${msg.refusal}`), { status: 422 });
    if (res.choices[0].finish_reason === 'length') throw Object.assign(new Error('La respuesta del modelo se cortó por longitud.'), { status: 413, truncatedOutput: true });
    return parseJsonLoose(msg.content);
  }

  return {
    provider: cfg.provider,
    model,

    async structured({ system, user, name, schema, maxTokens }) {
      const order = ['json_schema', 'json_object', 'prompt'];
      let lastErr;
      for (const f of order.slice(order.indexOf(mode))) {
        try {
          const out = await complete(system, user, name, schema, f, maxTokens);
          mode = f;
          return out;
        } catch (e) {
          lastErr = e;
          if (e.truncatedOutput) throw e;
          // Solo se prueba el siguiente formato si el error es de formato (400) o de JSON inválido.
          if (!(unsupportedFormat(e) || e instanceof SyntaxError)) throw e;
        }
      }
      throw lastErr;
    },

    async chat({ system, messages, tools, runTool }) {
      const oaTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      if (usesResponses) return responsesLoop();
      try {
        return await completionsLoop();
      } catch (e) {
        if (!needsResponsesApi(e)) throw e;
        usesResponses = true;
        return responsesLoop();
      }

      async function completionsLoop() {
        const conv = [{ role: 'system', content: system }, ...messages];
        for (let step = 0; step < 8; step++) {
          const res = await client.chat.completions.create({ model, messages: conv, tools: oaTools });
          const m = res.choices[0].message;
          conv.push(m);
          if (!m.tool_calls?.length) return m.content || '';
          for (const tc of m.tool_calls) {
            const out = await runTool(tc.function.name, tc.function.arguments);
            conv.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
          }
        }
        return 'Listo, apliqué los cambios. Revisa el dashboard.';
      }

      async function responsesLoop() {
        const respTools = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
        let res = await client.responses.create({ model, instructions: system, input: messages.map((m) => ({ role: m.role, content: m.content })), tools: respTools });
        for (let step = 0; step < 8; step++) {
          const calls = (res.output || []).filter((o) => o.type === 'function_call');
          if (!calls.length) return res.output_text || '';
          const outputs = [];
          for (const c of calls) outputs.push({ type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(await runTool(c.name, c.arguments)) });
          res = await client.responses.create({ model, previous_response_id: res.id, input: outputs, tools: respTools });
        }
        return 'Listo, apliqué los cambios. Revisa el dashboard.';
      }
    },
  };
}

export async function listOpenAICompatibleModels(cfg) {
  const list = await openaiClient(cfg).models.list();
  let ids = list.data.map((m) => String(m.id).replace(/^models\//, ''));
  if (cfg.provider === 'openai') {
    ids = ids
      .filter((id) => /^(gpt-[0-9]|o[0-9])/.test(id))
      .filter((id) => !/(audio|realtime|transcribe|tts|search|image|embedding|codex|healthcare|instruct|-\d{4}-\d{2}-\d{2}$)/.test(id));
  }
  // Gemini lista también modelos de robótica, imagen, audio, video y embeddings: no sirven para chat de texto con JSON.
  if (cfg.provider === 'gemini') ids = ids.filter((id) => /^gemini/.test(id) && !/(embedding|image|imagen|tts|audio|live|robotics|veo|aqa|computer-use|learnlm|streaming|thinking-exp|native)/.test(id));
  return [...new Set(ids)];
}
