import { useEffect, useLayoutEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../lib/api.js';
import { useApp } from '../App.jsx';
import KeyGuide from './KeyGuide.jsx';

export default function Tour({ onClose }) {
  const { snap, setView, loadSample, openDialog } = useApp();
  const steps = [
    { title: 'Bienvenido a SalamiOne', text: 'En un minuto te muestro cómo pasar de tus documentos a un dashboard de CIS Controls v8.1, exportarlo y medir el antes y el después.' },
    { target: '[data-tour="workspace"]', title: 'Una evaluación por organización', text: 'Cada evaluación tiene su Implementation Group: IG1 (56 salvaguardas), IG2 (130) o IG3 (153). Desde aquí creas, cambias o renombras evaluaciones.' },
    { target: '[data-tour="ai"]', title: 'Conecta tu propio modelo', text: 'Usa tu API key de OpenAI, Claude o Gemini, o un modelo local con Ollama. Sin IA conectada funciona el motor demo de reglas. En el siguiente paso te muestro cómo conseguir la clave.' },
    {
      title: 'Cómo conseguir tu API key',
      text: 'Elige tu proveedor y sigue los pasos. Lo haces una sola vez: la clave queda guardada en tu cuenta.',
      guide: true,
      cta: { label: 'Configurarla ahora', run: () => openDialog('ai') },
    },
    { target: '[data-tour="composer"]', view: 'chat', title: 'Documentos o chat', text: 'Adjunta PDF, DOCX o TXT con el clip, o describe tu organización en un mensaje y pide el dashboard. Cada conclusión lleva una cita verificada.' },
    { target: '[data-tour="tab-fuentes"]', title: 'Fuentes', text: 'Todos los archivos y textos que subiste: revisa el texto extraído, descárgalo, elimina lo que no corresponda y vuelve a analizar.' },
    { target: '[data-tour="tab-versiones"]', title: 'Versiones en tres pasos', text: 'Elige la versión anterior, después la nueva, y SalamiOne te dice si la postura mejoró o empeoró y qué cambió.' },
    ...(snap.analysis ? [{ target: '[data-tour="export"]', view: 'dashboard', title: 'Exporta en un clic', text: 'Descarga el dashboard en PDF o Excel, o un resumen ejecutivo de una página para la dirección.' }] : []),
    { title: 'Pruébalo con el caso de ejemplo', text: 'Carga Distribuidora Andina S.A. y mira la evaluación completa. Después sube su avance de iniciativas para comparar versiones.', action: !snap.analysis },
  ];
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const s = steps[i];
  const last = i === steps.length - 1;

  const end = () => {
    api('PUT', '/api/me', { onboarded: true }).catch(() => {});
    onClose();
  };

  useEffect(() => {
    if (s.view) setView(s.view);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const place = () => {
      const el = s.target && document.querySelector(s.target);
      const r = el?.getClientRects().length ? el.getBoundingClientRect() : null;
      setRect(r ? { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 } : null);
    };
    const t = setTimeout(place, s.view ? 260 : 0);
    window.addEventListener('resize', place);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', place);
    };
  }, [i, s.target, s.view]);

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') end();
      if (e.key === 'ArrowRight' && !last) setI((x) => x + 1);
      if (e.key === 'ArrowLeft' && i > 0) setI((x) => x - 1);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  const next = () => {
    if (s.action) {
      end();
      return loadSample('contexto');
    }
    if (last) return end();
    setI(i + 1);
  };

  const cardW = Math.min(s.guide ? 580 : 360, window.innerWidth - 32);
  let pos = { left: '50%', top: '50%', x: '-50%', y: '-50%' };
  if (rect) {
    const below = rect.y + rect.h + 14;
    const top = below + 230 > window.innerHeight ? Math.max(16, rect.y - 244) : below;
    // (los pasos con guía no tienen objetivo: se muestran centrados)
    const left = Math.min(Math.max(16, rect.x + rect.w / 2 - cardW / 2), window.innerWidth - cardW - 16);
    pos = { left, top, x: 0, y: 0 };
  }

  return (
    <motion.div className="tour" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {rect ? (
        <motion.div className="tour-spot" initial={false} animate={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} transition={{ type: 'spring', stiffness: 260, damping: 30 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <motion.div className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" style={{ width: cardW }} initial={false} animate={pos} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
        <div className="tour-progress" aria-hidden="true">
          {steps.map((_, k) => (
            <i key={k} className={k <= i ? 'on' : ''} />
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
            <p className="eyebrow">
              Paso {i + 1} de {steps.length}
            </p>
            <h2 id="tour-title">{s.title}</h2>
            <p className="tour-text">{s.text}</p>
            {s.guide && <KeyGuide initial={snap.agent.ai.provider || 'openai'} />}
          </motion.div>
        </AnimatePresence>
        <div className="row between">
          <button type="button" className="link-btn" onClick={end}>
            Saltar tutorial
          </button>
          <div className="row">
            {i > 0 && (
              <button type="button" className="btn small" onClick={() => setI(i - 1)}>
                Anterior
              </button>
            )}
            {s.cta && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  end();
                  s.cta.run();
                }}
              >
                {s.cta.label}
              </button>
            )}
            <button type="button" className="btn primary small" onClick={next} autoFocus>
              {s.action ? 'Cargar el caso de ejemplo' : last ? 'Empezar' : 'Siguiente'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
