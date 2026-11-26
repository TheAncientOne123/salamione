import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../lib/api.js';
import { useApp, EVIDENCE_STEPS } from '../App.jsx';
import KeyGuide, { GUIDES } from './KeyGuide.jsx';
import ModelPicker from './ModelPicker.jsx';

/** Modal accesible con animación de entrada; Escape y clic en el fondo cierran. */
export function Modal({ title, onClose, children, wide = false, labelledBy = 'modal-title' }) {
  const box = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    box.current?.querySelector('input, select, textarea, button:not(.modal-x)')?.focus();
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div
        ref={box}
        className={`modal${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      >
        <h2 id={labelledBy}>{title}</h2>
        {children}
      </motion.div>
    </motion.div>
  );
}

export function ConfirmDialog({ title, text, ok = 'Continuar', danger, onAnswer }) {
  return (
    <Modal title={title} onClose={() => onAnswer(false)} labelledBy="confirm-title">
      {text && <p className="muted">{text}</p>}
      <div className="row end">
        <button className="btn" onClick={() => onAnswer(false)}>
          Cancelar
        </button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => onAnswer(true)} autoFocus>
          {ok}
        </button>
      </div>
    </Modal>
  );
}

export function PasteDialog({ onClose }) {
  const { snap, setSnap, toast, withLoader, afterProposal, pushMsg, runAnalysis } = useApp();
  const [name, setName] = useState('');
  const [role, setRole] = useState(snap.analysis ? 'evidencia' : 'contexto');
  const [text, setText] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    onClose();
    let s;
    await withLoader(role === 'evidencia' ? 'Procesando la nueva evidencia' : 'Agregando el texto…', role === 'evidencia' ? EVIDENCE_STEPS : [], async () => {
      try {
        s = await api('POST', '/api/documents/text', { name: name.trim() || 'Nota', text, role });
        setSnap(s);
      } catch (err) {
        toast(err.message, true);
      }
    });
    if (!s) return;
    if (role === 'evidencia') return afterProposal(s.proposal);
    pushMsg({ role: 'system', content: `${name.trim() || 'Nota'} agregado como documento de contexto.` });
    toast('Texto agregado a Fuentes.');
    if (!s.analysis) await runAnalysis(true);
  };
  return (
    <Modal title="Pegar texto como documento" onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Nombre</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Política de respaldos" />
        </label>
        <label className="field">
          <span>Tipo</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="contexto">Documento de contexto (evaluación)</option>
            <option value="evidencia" disabled={!snap.analysis}>
              Nueva evidencia (avance o cambios)
            </option>
          </select>
        </label>
        <label className="field">
          <span>Contenido</span>
          <textarea className="input" rows={10} required value={text} onChange={(e) => setText(e.target.value)} placeholder="Pega el contenido…" />
        </label>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary">
            Agregar
          </button>
        </div>
      </form>
    </Modal>
  );
}

const IG_INFO = [
  { ig: 1, n: 56, text: 'Higiene cibernética esencial. Pymes, TI limitada, datos de baja sensibilidad.' },
  { ig: 2, n: 130, text: 'Varias áreas o sedes, datos sensibles de clientes, requisitos regulatorios.' },
  { ig: 3, n: 153, text: 'Equipo de seguridad propio, datos o servicios críticos, alta exposición.' },
];

export function WorkspaceDialog({ mode, onClose }) {
  const { snap, setSnap, toast, setView } = useApp();
  const edit = mode === 'ws-edit';
  const [name, setName] = useState(edit ? snap.workspace.name : '');
  const [ig, setIg] = useState(edit ? snap.workspace.ig : 1);
  const submit = async (e) => {
    e.preventDefault();
    try {
      if (edit) setSnap(await api('PUT', `/api/workspaces/${snap.workspace.id}`, { name, ig }));
      else {
        setSnap(await api('POST', '/api/workspaces', { name, ig }));
        setView('chat');
        toast(`Evaluación creada: ${name} (IG${ig}).`);
      }
      onClose();
    } catch (err) {
      toast(err.message, true);
    }
  };
  return (
    <Modal title={edit ? 'Editar evaluación' : 'Nueva evaluación'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Nombre de la organización o evaluación</span>
          <input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Acme S.A. · 2026" />
        </label>
        <fieldset className="ig-choices">
          <legend>Implementation Group objetivo</legend>
          {IG_INFO.map((x) => (
            <label key={x.ig} className={`ig-choice${ig === x.ig ? ' on' : ''}`}>
              <input type="radio" name="ig" checked={ig === x.ig} onChange={() => setIg(x.ig)} />
              <span>
                <b>
                  IG{x.ig} · {x.n} salvaguardas
                </b>
                <small>{x.text}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {edit && snap.analysis && ig !== snap.workspace.ig && (
          <p className="notice-inline small">Al cambiar el IG, vuelve a analizar la documentación para evaluar las salvaguardas nuevas.</p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary">
            {edit ? 'Guardar' : 'Crear evaluación'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const CLIENT_TIMEOUT = 60000; // el servidor corta a los 45 s; esto es una red de seguridad

export function AiDialog({ onClose }) {
  const { setSnap, toast } = useApp();
  const [settings, setSettings] = useState(null);
  const [provider, setProvider] = useState(null);
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  const [recommended, setRecommended] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null); // 'models' | 'test' | 'save'
  const [elapsed, setElapsed] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
  const ctrl = useRef(null);

  useEffect(() => {
    api('GET', '/api/me/ai')
      .then((s) => {
        setSettings(s);
        setProvider(s.config?.provider || (s.server ? 'server' : 'openai'));
        setUrl(s.config?.baseURL || '');
        setModel(s.config?.model || '');
      })
      .catch((e) => toast(e.message, true));
    return () => ctrl.current?.abort();
  }, [toast]);

  // Contador visible mientras se espera al proveedor.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);

  if (!settings) return null;
  const p = settings.providers[provider];
  const saved = settings.config?.provider === provider ? settings.config : null;
  const hasKey = !!key.trim() || !!saved?.key;
  const body = () => ({ provider, apiKey: key.trim() || undefined, baseURL: url.trim(), model: model.trim() });

  /** Ejecuta una llamada cancelable con tiempo límite; solo una a la vez. */
  const run = async (kind, fn) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const timer = setTimeout(() => c.abort('timeout'), CLIENT_TIMEOUT);
    setBusy(kind);
    try {
      return await fn(c.signal);
    } catch (e) {
      if (c.signal.aborted) {
        setResult(c.signal.reason === 'timeout' ? { ok: false, text: 'El proveedor no respondió en 60 s. Revisa la URL base o prueba con otro modelo.' } : { ok: true, text: 'Cancelado.' });
        return null;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (ctrl.current === c) {
        ctrl.current = null;
        setBusy(null);
      }
    }
  };
  const cancel = () => ctrl.current?.abort('user');

  const choose = (k) => {
    if (k === provider) return;
    cancel();
    setProvider(k);
    const same = settings.config?.provider === k;
    setModel(same ? settings.config.model : '');
    setUrl(same ? settings.config.baseURL : '');
    setKey('');
    setModels([]);
    setRecommended('');
    setResult(null);
  };
  const cards = [
    ...Object.entries(settings.providers).map(([k, x]) => ({ k, label: x.label, sub: x.needsKey ? 'Con tu API key' : 'Sin clave' })),
    ...(settings.server ? [{ k: 'server', label: 'IA del servidor', sub: settings.server.model }] : []),
    { k: 'none', label: 'Motor demo', sub: 'Reglas, sin IA' },
  ];

  const loadModels = async ({ quiet = false } = {}) => {
    if (p?.needsKey && !hasKey) return !quiet && setResult({ ok: false, text: 'Escribe la API key primero.' });
    if (!quiet) setResult(null);
    try {
      const r = await run('models', (signal) => api('POST', '/api/me/ai/models', body(), { signal }));
      if (!r) return;
      setModels(r.models);
      setRecommended(r.recommended || '');
      // Si no hay modelo, o el escrito no está entre los modelos de texto de la cuenta, se usa el recomendado.
      const current = model.trim();
      const replace = r.recommended && (!current || (r.models.length && !r.models.includes(current) && !/-latest$/.test(current)));
      if (replace) setModel(r.recommended);
      setResult({
        ok: true,
        text:
          `${r.models.length} modelos de texto disponibles en tu cuenta. ` +
          (replace ? (current ? `"${current}" no sirve para chat de texto; elegí ${r.recommended} (recomendado).` : `Elegí ${r.recommended} (recomendado).`) : '') +
          ' Abre la lista para ver todos.',
      });
    } catch (e) {
      setResult({ ok: false, text: e.message });
    }
  };

  const test = async () => {
    if (!p) return setResult({ ok: false, text: 'Elige un proveedor para probar.' });
    setResult(null);
    try {
      const r = await run('test', (signal) => api('POST', '/api/me/ai/test', body(), { signal }));
      if (!r) return;
      if (!model.trim()) setModel(r.model);
      if (r.models?.length) setModels(r.models);
      setResult({ ok: true, text: `Conexión correcta con ${r.label} en ${(r.ms / 1000).toFixed(1)} s: la clave funciona, el modelo existe y devuelve respuestas estructuradas.` });
    } catch (e) {
      setResult({ ok: false, text: e.message });
    }
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const r = await run('save', (signal) => api('PUT', '/api/me/ai', body(), { signal }));
      if (!r) return;
      setSnap(r.state);
      toast(r.state.agent.ai.connected ? `IA conectada: ${r.state.agent.ai.label}.` : 'Usando el motor demo (sin IA).');
      onClose();
    } catch (err) {
      setResult({ ok: false, text: err.message });
    }
  };

  const busyText = { models: 'Consultando los modelos de tu cuenta…', test: 'Probando la conexión…', save: 'Guardando…' }[busy];

  return (
    <Modal title="Conecta tu modelo de IA" onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <p className="muted small">SalamiOne funciona con tu propia cuenta. La API key se guarda cifrada en el servidor y nunca vuelve al navegador.</p>
        <div className="prov-grid" role="radiogroup" aria-label="Proveedor">
          {cards.map((c) => (
            <button type="button" key={c.k} role="radio" aria-checked={provider === c.k} className={`prov${provider === c.k ? ' on' : ''}`} onClick={() => choose(c.k)}>
              <b>{c.label}</b>
              <small>{c.sub}</small>
            </button>
          ))}
        </div>
        {GUIDES[provider] && (
          <div className="guide-toggle">
            <button type="button" className="link-btn" aria-expanded={showGuide} onClick={() => setShowGuide((v) => !v)}>
              {showGuide ? 'Ocultar la guía' : provider === 'ollama' ? '¿Cómo instalo Ollama y elijo un modelo?' : `¿Cómo consigo la API key de ${GUIDES[provider].label}?`}
            </button>
            <AnimatePresence initial={false}>
              {showGuide && (
                <motion.div className="guide-box" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <KeyGuide provider={provider} onProvider={() => {}} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {provider === 'compatible' && (
          <p className="muted small">
            Para LM Studio, OpenRouter, Azure, vLLM u otros servidores: copia la URL base que indica su documentación (la parte que termina en <code>/v1</code>, sin <code>/chat/completions</code>), la API key si la piden y el nombre exacto del modelo.
          </p>
        )}
        {p && (
          <div className="ai-fields">
            {(p.needsKey || provider === 'compatible') && (
              <label className="field">
                <span>
                  API key
                  {p.keyUrl && (
                    <a href={p.keyUrl} target="_blank" rel="noopener noreferrer">
                      Obtener una
                    </a>
                  )}
                </span>
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onBlur={() => key.trim().length > 10 && !models.length && !busy && loadModels({ quiet: true })}
                  placeholder={saved?.key ? `Guardada (${saved.key}). Escribe una nueva para reemplazarla.` : p.needsKey ? p.hint : 'Opcional'}
                />
                <small className="muted">{p.needsKey ? p.hint : 'Opcional: solo si tu servidor la exige.'}</small>
              </label>
            )}
            {['ollama', 'compatible'].includes(provider) && (
              <label className="field">
                <span>URL base</span>
                <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={p.baseURL || 'https://mi-servidor/v1'} />
                <small className="muted">{provider === 'ollama' ? 'Por defecto http://localhost:11434 (se completa /v1).' : 'Debe terminar en /v1 (p. ej. http://localhost:1234/v1 para LM Studio).'}</small>
              </label>
            )}
            <div className="field">
              <span>
                Modelo
                <button type="button" className="link-btn" onClick={() => loadModels()} disabled={!!busy}>
                  {models.length ? 'Actualizar lista' : 'Cargar modelos disponibles'}
                </button>
              </span>
              <ModelPicker
                value={model}
                onChange={setModel}
                models={models}
                recommended={recommended}
                loading={busy === 'models'}
                onRequestModels={() => loadModels()}
                placeholder={p.defaultModel ? `${p.defaultModel} (si lo dejas vacío)` : 'nombre-del-modelo'}
              />
            </div>
          </div>
        )}
        <AnimatePresence mode="wait">
          {busy ? (
            <motion.div key="busy" className="ai-result small ok ai-busy" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="mini-spin" aria-hidden="true" />
              <span>
                {busyText} <span className="num muted">{elapsed} s</span>
                {busy === 'test' && elapsed >= 8 && <span className="muted"> · Los modelos con razonamiento o locales pueden tardar hasta 45 s.</span>}
              </span>
              <button type="button" className="link-btn" onClick={cancel}>
                Cancelar
              </button>
            </motion.div>
          ) : (
            result && (
              <motion.p key="res" className={`ai-result small ${result.ok ? 'ok' : 'bad'}`} role={result.ok ? 'status' : 'alert'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {result.text}
              </motion.p>
            )
          )}
        </AnimatePresence>
        <div className="row between">
          <button type="button" className="btn ghost" onClick={test} disabled={!p || !!busy}>
            Probar conexión
          </button>
          <div className="row">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={!!busy}>
              Guardar
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
