// Guía para conseguir y conectar la API key de cada proveedor.
// Se usa en el tutorial y dentro de "Conecta tu modelo de IA".
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

const Ext = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

export const GUIDES = {
  openai: {
    label: 'OpenAI',
    note: 'La API se paga aparte de ChatGPT Plus: sin saldo cargado, la clave no funciona.',
    steps: [
      <>
        Entra a <Ext href="https://platform.openai.com/api-keys">platform.openai.com/api-keys</Ext> con tu cuenta de OpenAI.
      </>,
      <>
        Pulsa <b>Create new secret key</b> y copia la clave (empieza con <code>sk-</code>). Solo se muestra una vez.
      </>,
      <>
        Carga saldo en <Ext href="https://platform.openai.com/settings/organization/billing/overview">Settings → Billing</Ext>.
      </>,
      <>
        En SalamiOne elige <b>OpenAI</b>, pega la clave, deja el modelo vacío o escribe uno (p. ej. <code>gpt-4.1</code>), pulsa <b>Probar conexión</b> y después <b>Guardar</b>.
      </>,
    ],
  },
  anthropic: {
    label: 'Claude',
    note: 'Necesitas créditos en la consola de Anthropic; la suscripción a Claude.ai no incluye la API.',
    steps: [
      <>
        Entra a <Ext href="https://console.anthropic.com/settings/keys">console.anthropic.com/settings/keys</Ext> e inicia sesión.
      </>,
      <>
        Pulsa <b>Create Key</b>, ponle un nombre (p. ej. SalamiOne) y copia la clave (empieza con <code>sk-ant-</code>).
      </>,
      <>
        Agrega créditos en la sección <b>Billing</b> de la consola.
      </>,
      <>
        En SalamiOne elige <b>Anthropic (Claude)</b>, pega la clave, deja el modelo vacío (usa <code>claude-opus-5-5</code>), pulsa <b>Probar conexión</b> y después <b>Guardar</b>.
      </>,
    ],
  },
  gemini: {
    label: 'Gemini',
    note: 'No hace falta ninguna URL: SalamiOne ya sabe a dónde conectarse. Si copias un ejemplo con curl, solo te sirven la clave y el nombre del modelo.',
    steps: [
      <>
        Entra a <Ext href="https://aistudio.google.com/apikey">aistudio.google.com/apikey</Ext> con tu cuenta de Google.
      </>,
      <>
        Pulsa <b>Create API key</b>, elige o crea un proyecto y copia la clave.
      </>,
      <>
        En SalamiOne elige <b>Google Gemini</b> y pega la clave. Los modelos se cargan solos; si quieres uno en particular escríbelo (p. ej. <code>gemini-flash-latest</code>).
      </>,
      <>
        Pulsa <b>Probar conexión</b> y después <b>Guardar</b>.
      </>,
    ],
  },
  ollama: {
    label: 'Ollama (local)',
    note: 'Sin clave y sin costo por uso: el modelo corre en tu equipo y los documentos no salen de tu red. Ollama tiene que estar en la misma máquina que el servidor de SalamiOne, o accesible desde ella.',
    steps: [
      <>
        Instala Ollama desde <Ext href="https://ollama.com/download">ollama.com/download</Ext>.
      </>,
      <>
        Descarga un modelo desde la terminal: <code>ollama pull llama3.1</code>.
      </>,
      <>
        Deja Ollama abierto (escucha en <code>http://localhost:11434</code>).
      </>,
      <>
        En SalamiOne elige <b>Ollama (local)</b>, deja la URL vacía (o escribe la de tu servidor), pulsa <b>Probar conexión</b> y después <b>Guardar</b>. La primera respuesta puede tardar mientras el modelo se carga en memoria.
      </>,
    ],
  },
};

/** provider: proveedor inicial (o controlado, si se pasa onProvider). */
export default function KeyGuide({ provider: controlled, onProvider, initial = 'openai' }) {
  const [own, setOwn] = useState(initial);
  const provider = GUIDES[controlled] ? controlled : own;
  const set = (k) => (onProvider ? onProvider(k) : setOwn(k));
  const g = GUIDES[provider];
  return (
    <div className="key-guide">
      {!onProvider && (
        <div className="kg-tabs" role="tablist" aria-label="Proveedor">
          {Object.entries(GUIDES).map(([k, x]) => (
            <button key={k} type="button" role="tab" aria-selected={provider === k} className={provider === k ? 'on' : ''} onClick={() => set(k)}>
              {provider === k && <motion.span layoutId="kg-pill" className="kg-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span className="rel">{x.label}</span>
            </button>
          ))}
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={provider} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
          <ol className="kg-steps">
            {g.steps.map((s, k) => (
              <li key={k}>{s}</li>
            ))}
          </ol>
          <p className="kg-note">{g.note}</p>
        </motion.div>
      </AnimatePresence>
      <p className="kg-safe">Tu clave se guarda cifrada y nunca vuelve al navegador. No la compartas: si quedó expuesta (en un chat, un repositorio o una captura), revócala y crea otra.</p>
    </div>
  );
}
