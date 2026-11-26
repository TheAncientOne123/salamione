import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { pct } from '@shared/scoring.js';
import { Markdown, Icon } from '../../lib/ui.jsx';
import { useApp } from '../App.jsx';
import { Dropdown } from '../parts/Topbar.jsx';

const DESCRIBE_TEMPLATE = `Somos [organización], del sector [sector], con [N] empleados y [sedes].
Infraestructura: [servidores propios / cloud / híbrido], [N] equipos de usuario.
Cuentas y accesos: [¿cuentas nominales? ¿MFA en correo, VPN y administradores?].
Respaldos: [frecuencia, copia fuera de sitio, pruebas de restauración].
Parches y antimalware: [cómo se actualiza, qué antivirus/EDR].
Registros y monitoreo: [logs, SIEM, revisiones].
Capacitación: [concienciación, phishing].
Incidentes y proveedores: [responsable, procedimiento, contratos].`;

function Action({ a }) {
  const { download, setView } = useApp();
  const kind = (href) => (/xlsx/.test(href) ? 'Excel' : 'PDF');
  return (
    <div className="action">
      <span className="action-icon">
        <Icon name={a.href ? 'download' : 'spark'} size={16} />
      </span>
      <span className="action-text">
        {a.text}
        {a.before !== undefined && a.after != null && (
          <>
            {' '}
            · implementación {pct(a.before)} → <strong>{pct(a.after)}</strong>
          </>
        )}
      </span>
      {a.href ? (
        <>
          <button className="go" onClick={() => download(a.href, `Generando el ${kind(a.href)}…`)}>
            {kind(a.href)} ↓
          </button>
          {a.extra && (
            <button className="go" onClick={() => download(a.extra.href, 'Generando el Excel…', ['Armando las hojas…'])}>
              {a.extra.label} ↓
            </button>
          )}
        </>
      ) : (
        <button className="go" onClick={() => setView(a.view || 'dashboard')}>
          Ver {a.view === 'versiones' ? 'versiones' : 'dashboard'} →
        </button>
      )}
    </div>
  );
}

export default function ChatView() {
  const { snap, chat, busy, sendChat, pickFiles, openDialog, loadSample, runAnalysis, evaluateFromChat, uploadFiles } = useApp();
  const [text, setText] = useState('');
  const [drag, setDrag] = useState(0);
  const scroller = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length, busy]);

  const grow = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(220, el.scrollHeight) + 'px';
  };
  useEffect(grow, [text]);

  const submit = (e) => {
    e.preventDefault();
    const v = text.trim();
    if (!v || busy) return;
    setText('');
    sendChat(v);
  };

  const written = chat.filter((m) => m.role === 'user').reduce((n, m) => n + m.content.length, 0);
  const offerEval = !snap.analysis && !busy && written >= 160;

  let suggestions;
  if (!snap.documents.length && !snap.analysis) {
    suggestions = [
      { label: 'Cargar el caso de ejemplo', run: () => loadSample('contexto') },
      { label: 'Subir un documento de contexto', run: () => pickFiles('contexto') },
      { label: 'Describir mi organización en el chat', run: () => setText(DESCRIBE_TEMPLATE) },
      { label: '¿Qué diferencia hay entre IG1, IG2 e IG3?' },
    ];
  } else if (!snap.analysis) {
    suggestions = [{ label: 'Analizar la documentación', run: () => runAnalysis() }, { label: `¿Qué salvaguardas de ${snap.catalog.shortName} vas a evaluar y con qué criterios?` }];
  } else {
    suggestions = [
      { label: '¿Cuál es la postura actual de ciberseguridad?' },
      { label: '¿Cuáles son los cinco riesgos principales?' },
      { label: 'Genera el resumen ejecutivo de una página' },
      { label: 'Subir nueva evidencia para comparar', run: () => pickFiles('evidencia') },
    ];
  }

  return (
    <div
      className="chat-wrap"
      onDragEnter={(e) => [...e.dataTransfer.types].includes('Files') && setDrag((d) => d + 1)}
      onDragLeave={() => setDrag((d) => Math.max(0, d - 1))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(0);
        if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files], 'contexto');
      }}
    >
      <div className="chat-scroll" ref={scroller}>
        <div className="chat-inner">
          {!chat.length && (
            <motion.div className="welcome" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <motion.img src="/logo.svg" alt="" width="84" height="84" initial={{ rotate: -90, scale: 0.7 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 14 }} />
              <h1>Tu asesor en CIS Controls v8.1</h1>
              <p>
                Sube la documentación de {snap.workspace.name === 'Mi primera evaluación' ? 'la organización' : snap.workspace.name} o descríbela aquí mismo. Evalúo las {snap.catalog.safeguards.length} salvaguardas de{' '}
                {snap.catalog.shortName} con citas verificadas y armo el dashboard.
              </p>
              <div className="suggestions">
                {suggestions.map((s, k) => (
                  <motion.button key={s.label} className="suggestion" onClick={() => (s.run ? s.run() : sendChat(s.label))} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * k }}>
                    {s.label}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
          <div className="chat-log" aria-live="polite">
            <AnimatePresence initial={false}>
              {chat.map((m, k) => (
                <motion.div key={k} className={`msg ${m.role}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                  {m.role === 'assistant' && <img className="avatar" src="/logo.svg" alt="SalamiOne" />}
                  <div className="bubble">
                    {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
                    {!!m.actions?.length && (
                      <div className="actions">
                        {m.actions.map((a, j) => (
                          <Action key={j} a={a} />
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
              {busy && (
                <motion.div key="typing" className="msg assistant" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <img className="avatar" src="/logo.svg" alt="" />
                  <div className="typing-dots" aria-label="SalamiOne está escribiendo">
                    <i />
                    <i />
                    <i />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <form className="composer" onSubmit={submit} data-tour="composer">
        <AnimatePresence>
          {offerEval && (
            <motion.div className="chat-eval" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
              <span>¿Describiste tu organización? Puedo convertir lo que escribiste en un dashboard.</span>
              <button type="button" className="btn primary small" onClick={evaluateFromChat}>
                Generar dashboard con esta descripción
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {snap.stale && (
          <div className="chat-eval soft">
            <span>Hay fuentes nuevas que todavía no están en la evaluación.</span>
            <button type="button" className="btn accent small" onClick={() => runAnalysis()}>
              {snap.analysis ? 'Rehacer evaluación' : 'Analizar'}
            </button>
          </div>
        )}
        <div className="composer-inner">
          <Dropdown
            className="attach-wrap"
            button={({ toggle, open }) => (
              <button type="button" className="icon-btn attach" onClick={toggle} aria-expanded={open} aria-haspopup="menu" title="Agregar fuentes" aria-label="Agregar fuentes">
                <Icon name="clip" />
              </button>
            )}
          >
            <button type="button" role="menuitem" onClick={() => pickFiles('contexto')}>
              Documento de contexto <small>Base de la evaluación (políticas, informes, inventarios)</small>
            </button>
            <button type="button" role="menuitem" onClick={() => pickFiles('evidencia')} disabled={!snap.analysis}>
              Nueva evidencia <small>Avance o cambios: propone actualizaciones sin rehacer el diagnóstico</small>
            </button>
            <button type="button" role="menuitem" onClick={() => openDialog('paste')}>
              Pegar texto <small>{snap.agent.supported.map((x) => x.slice(1).toUpperCase()).join(' · ')} también se pueden subir</small>
            </button>
            <button type="button" role="menuitem" onClick={() => loadSample(snap.analysis ? 'evidencia' : 'contexto')}>
              Cargar caso de ejemplo <small>Distribuidora Andina S.A. ({snap.analysis ? 'avance de iniciativas' : 'contexto'})</small>
            </button>
          </Dropdown>
          <textarea
            ref={input}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
            }}
            placeholder="Pregunta sobre CIS Controls o describe tu organización…"
            aria-label="Mensaje"
          />
          <button className="btn primary send" disabled={busy || !text.trim()}>
            Enviar
          </button>
        </div>
        <p className="composer-hint small">
          Evaluación contra {snap.catalog.shortName} ({snap.catalog.safeguards.length} salvaguardas). Puedes arrastrar archivos aquí.
        </p>
      </form>
      <AnimatePresence>
        {drag > 0 && (
          <motion.div className="drop-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div>Suelta los archivos para agregarlos como documento de contexto</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
