import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { computeDashboard, pct } from '@shared/scoring.js';
import { api, downloadFile, local } from '../lib/api.js';
import Topbar from './parts/Topbar.jsx';
import { ConfirmDialog, PasteDialog, WorkspaceDialog, AiDialog } from './parts/Dialogs.jsx';
import Tour from './parts/Tour.jsx';
import ChatView from './views/ChatView.jsx';
import DashboardView from './views/DashboardView.jsx';
import SourcesView from './views/SourcesView.jsx';
import VersionsView from './views/VersionsView.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export const VIEWS = ['chat', 'dashboard', 'fuentes', 'versiones'];
// Nombres de la versión anterior de la app (pueden seguir guardados en el navegador o en enlaces).
const LEGACY_VIEWS = { versions: 'versiones', compare: 'versiones', sources: 'fuentes' };
const normView = (v) => (VIEWS.includes(v) ? v : LEGACY_VIEWS[v] || null);
const initialView = () => normView(location.hash.slice(1)) || normView(local.get('s1-view', 'chat')) || 'chat';

export const analysisSteps = (c) => [
  'Interpretando el contexto de la organización…',
  `Evaluando ${c.safeguards.length} salvaguardas de ${c.shortName}…`,
  'Verificando cada cita contra el texto original…',
  'Identificando riesgos y armando el roadmap…',
  'Calculando implementación y cobertura…',
];
export const EVIDENCE_STEPS = ['Leyendo la nueva evidencia…', 'Comparando contra la matriz actual (sin rehacer el diagnóstico)…', 'Verificando las citas…', 'Armando la propuesta de cambios para validar…'];
export const PDF_STEPS = ['Completando la plantilla…', 'Imprimiendo el documento…'];

export default function App() {
  const [snap, setSnapState] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [view, setViewState] = useState(initialView);
  const [chat, setChat] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loader, setLoader] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [dialog, setDialog] = useState(null); // 'paste' | 'ws-new' | 'ws-edit' | 'ai'
  const [tour, setTour] = useState(false);
  const wsRef = useRef(null);
  const lastErr = useRef(null);
  const fileInput = useRef(null);
  const uploadRole = useRef('contexto');

  // ---------- estado ----------
  const toast = useCallback((text, error = false) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 7000 : 3600);
  }, []);

  const setSnap = useCallback(
    (s) => {
      if (wsRef.current !== s.workspace.id) {
        wsRef.current = s.workspace.id;
        setChat(local.get(`s1-chat-${s.workspace.id}`, []));
      }
      setSnapState(s);
      setOverrides({ ...s.overrides });
      const err = s.agent.error;
      if (err && err.at !== lastErr.current) {
        lastErr.current = err.at;
        toast(err.message, true);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (wsRef.current) local.set(`s1-chat-${wsRef.current}`, chat.slice(-60));
  }, [chat]);

  const setView = useCallback((raw) => {
    const v = normView(raw) || 'chat';
    setViewState(v);
    local.set('s1-view', v);
    history.replaceState(null, '', '#' + v);
  }, []);

  useEffect(() => {
    api('GET', '/api/state')
      .then((s) => {
        setSnap(s);
        if (!s.user.onboarded) setTour(true);
      })
      .catch((e) => toast(e.message, true));
  }, [setSnap, toast]);

  const dashboard = useMemo(() => (snap?.analysis ? computeDashboard(snap.catalog, snap.analysis, overrides) : null), [snap, overrides]);

  // ---------- utilidades ----------
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);

  const withLoader = useCallback(async (title, steps, fn) => {
    setLoader({ title, steps });
    try {
      return await fn();
    } finally {
      setLoader(null);
    }
  }, []);

  const download = useCallback(
    (url, title = 'Generando el archivo…', steps = PDF_STEPS) =>
      withLoader(title, steps, async () => {
        try {
          const name = await downloadFile(url);
          if (name) toast(`Descargado: ${name}`);
        } catch (e) {
          toast(e.message, true);
        }
      }),
    [withLoader, toast]
  );

  const pushMsg = useCallback((m) => setChat((c) => [...c, m]), []);

  // ---------- acciones ----------
  const announceAnalysis = (s, source) => {
    const d = computeDashboard(s.catalog, s.analysis, s.overrides);
    const n = d.counts;
    pushMsg({
      role: 'assistant',
      content:
        `Evaluación lista para **${d.company.name === 'No informado' ? s.workspace.name : d.company.name}** a partir de ${source}. Evalué las ${d.total} salvaguardas de ${d.shortName}.\n\n` +
        `- **Implementación:** ${pct(d.implementation)} sobre ${d.evaluable} salvaguardas evaluables\n` +
        `- **Cobertura de evaluación:** ${pct(d.coverage)}\n` +
        `- ${n.implementado} implementadas · ${n.parcial} parciales · ${n.no_implementado} no implementadas · ${n.no_verificado} no verificadas · ${n.no_aplicable} no aplicables\n\n` +
        `Identifiqué ${d.risks.length} riesgos principales y propuse ${d.initiatives.length} iniciativas. Las no verificadas no cuentan como incumplimiento.`,
      actions: [{ text: 'Evaluación guardada como versión', view: 'dashboard' }],
    });
  };

  const runAnalysis = async (skipConfirm = false) => {
    if (!snap.documents.some((d) => d.role !== 'evidencia')) return toast('Agrega al menos un documento de contexto.', true);
    if (snap.analysis && !skipConfirm && !(await confirm({ title: '¿Rehacer la evaluación?', text: 'Reemplaza el diagnóstico actual. Las versiones anteriores se conservan para comparar.', ok: 'Rehacer evaluación' }))) return;
    await withLoader('Analizando la documentación', analysisSteps(snap.catalog), async () => {
      try {
        const s = await api('POST', '/api/analyze');
        setSnap(s);
        announceAnalysis(s, 'los documentos cargados');
      } catch (e) {
        toast(e.message, true);
      }
    });
  };

  const afterProposal = (p) => {
    if (!p) return;
    const pend = p.changes.filter((c) => c.decision === 'pendiente').length;
    pushMsg({
      role: 'assistant',
      content:
        `Procesé **${p.documents.join(', ')}** sin rehacer el diagnóstico. Encontré ${p.initiatives.length} iniciativa(s) reportada(s) y **${pend} cambio(s) de estado propuestos** para que los valides.\n\n` +
        `Revísalos en el **Dashboard** (Actualización con nueva evidencia), aprueba los que correspondan y aplica. Después abre **Versiones** para ver si la postura mejoró o empeoró.`,
      actions: [{ text: 'Propuesta lista para validar', view: 'dashboard' }],
    });
    setView('dashboard');
  };

  const uploadFiles = async (files, role = 'contexto') => {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    if (role === 'evidencia') {
      if (!snap.analysis) return toast('Primero hace falta la evaluación inicial.', true);
      return withLoader('Procesando la nueva evidencia', EVIDENCE_STEPS, async () => {
        try {
          const s = await api('POST', '/api/evidence', fd);
          setSnap(s);
          if (s.errors?.length) toast(s.errors.join(' · '), true);
          afterProposal(s.proposal);
        } catch (e) {
          toast(e.message, true);
        }
      });
    }
    let s;
    await withLoader('Subiendo documentación…', [`Leyendo ${files.length} archivo${files.length > 1 ? 's' : ''}…`], async () => {
      try {
        s = await api('POST', '/api/documents', fd);
        setSnap(s);
        if (s.errors?.length) toast(s.errors.join(' · '), true);
      } catch (e) {
        toast(e.message, true);
      }
    });
    if (!s?.added?.length) return;
    pushMsg({ role: 'system', content: `${s.added.join(', ')} ${s.added.length > 1 ? 'agregados' : 'agregado'} como documento de contexto.` });
    const ok = await confirm({ title: '¿Analizar ahora?', text: `Se agregó ${s.added.join(', ')}. Puedes analizar ahora o seguir sumando fuentes y analizar después.`, ok: 'Analizar ahora' });
    if (ok) await runAnalysisWith(s);
  };

  // Análisis inmediatamente después de subir (usa el estado recién recibido).
  const runAnalysisWith = async (s) =>
    withLoader('Analizando la documentación', analysisSteps(s.catalog), async () => {
      try {
        const r = await api('POST', '/api/analyze');
        setSnap(r);
        announceAnalysis(r, 'los documentos cargados');
        setView('dashboard');
      } catch (e) {
        toast(e.message, true);
      }
    });

  const pickFiles = (role) => {
    if (role === 'evidencia' && !snap?.analysis) return toast('Primero hace falta la evaluación inicial: agrega un documento de contexto.', true);
    uploadRole.current = role;
    fileInput.current?.click();
  };

  const loadSample = async (role = 'contexto') => {
    if (role === 'evidencia' && !snap.analysis) return toast('Primero hace falta la evaluación inicial.', true);
    let s;
    await withLoader(role === 'evidencia' ? 'Procesando la evidencia de ejemplo' : 'Cargando el caso de ejemplo', role === 'evidencia' ? EVIDENCE_STEPS : ['Leyendo el PDF de Distribuidora Andina S.A.…'], async () => {
      try {
        s = await api('POST', `/api/sample/${role}`);
        setSnap(s);
      } catch (e) {
        toast(e.message, true);
      }
    });
    if (!s) return;
    if (role === 'evidencia') return afterProposal(s.proposal);
    pushMsg({ role: 'system', content: `Caso de ejemplo cargado: ${s.added.join(', ')}.` });
    await runAnalysisWith(s);
  };

  const evaluateFromChat = () =>
    withLoader('Armando el dashboard con tu descripción', analysisSteps(snap.catalog), async () => {
      try {
        const messages = chat.filter((m) => m.role !== 'system').map(({ role, content }) => ({ role, content }));
        const s = await api('POST', '/api/evaluate-chat', { messages, title: 'Descripción en el chat' });
        setSnap(s);
        announceAnalysis(s, 'tu descripción en el chat');
      } catch (e) {
        toast(e.message, true);
      }
    });

  const sendChat = async (text) => {
    if (busy) return;
    const history = [...chat, { role: 'user', content: text }];
    setChat(history);
    setBusy(true);
    try {
      const res = await api('POST', '/api/chat', { messages: history.filter((m) => m.role !== 'system').map(({ role, content }) => ({ role, content })) });
      setChat((c) => [...c, { role: 'assistant', content: res.reply, actions: res.actions }]);
      if (res.state) setSnap(res.state);
    } catch (e) {
      setChat((c) => [...c, { role: 'assistant', content: `No pude completar la respuesta: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const setSafeguard = async (id, status) => {
    const prev = overrides;
    const next = { ...overrides };
    if (status === 'documentado') delete next[id];
    else next[id] = status;
    setOverrides(next);
    try {
      setSnapState(await api('PUT', `/api/safeguards/${encodeURIComponent(id)}`, { status }));
    } catch (e) {
      setOverrides(prev);
      toast(e.message, true);
    }
  };

  const saveVersion = async (label) => {
    try {
      const s = await api('POST', '/api/versions', { label });
      setSnap(s);
      toast(`Versión v${s.versions.at(-1).n} guardada.`);
      return s;
    } catch (e) {
      toast(e.message, true);
    }
  };

  const resetWorkspace = async () => {
    if (!(await confirm({ title: '¿Vaciar esta evaluación?', text: 'Se borran los documentos, el análisis, las versiones y el chat de esta evaluación.', ok: 'Vaciar', danger: true }))) return;
    setChat([]);
    setSnap(await api('POST', '/api/reset'));
  };

  if (!snap) {
    return (
      <div className="boot">
        <img src="/logo.svg" alt="" width="56" height="56" className="boot-logo" />
      </div>
    );
  }

  const ctx = {
    snap, setSnap, dashboard, overrides, view, setView, chat, setChat, busy, pushMsg, toast, confirm, withLoader, download,
    runAnalysis, uploadFiles, pickFiles, loadSample, evaluateFromChat, sendChat, setSafeguard, saveVersion, resetWorkspace, afterProposal,
    openDialog: setDialog, startTour: () => setTour(true),
  };

  const View = { chat: ChatView, dashboard: DashboardView, fuentes: SourcesView, versiones: VersionsView }[view] || ChatView;

  return (
    <MotionConfig reducedMotion="user">
      <AppCtx.Provider value={ctx}>
        <div className="app">
          <Topbar />
          <main className="view-host">
            <AnimatePresence mode="wait" initial={false}>
              <motion.section
                key={view + snap.workspace.id}
                className={`view ${view === 'chat' ? 'chat-view' : 'dash-view'}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                <View />
              </motion.section>
            </AnimatePresence>
          </main>
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={snap.agent.supported.join(',')}
          onChange={(e) => {
            uploadFiles([...e.target.files], uploadRole.current);
            e.target.value = '';
          }}
        />

        <AnimatePresence>{dialog === 'paste' && <PasteDialog key="paste" onClose={() => setDialog(null)} />}</AnimatePresence>
        <AnimatePresence>{(dialog === 'ws-new' || dialog === 'ws-edit') && <WorkspaceDialog key="ws" mode={dialog} onClose={() => setDialog(null)} />}</AnimatePresence>
        <AnimatePresence>{dialog === 'ai' && <AiDialog key="ai" onClose={() => setDialog(null)} />}</AnimatePresence>
        <AnimatePresence>
          {confirmState && (
            <ConfirmDialog
              key="confirm"
              {...confirmState}
              onAnswer={(v) => {
                confirmState.resolve(v);
                setConfirmState(null);
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>{tour && <Tour key="tour" onClose={() => setTour(false)} />}</AnimatePresence>

        <AnimatePresence>
          {loader && (
            <motion.div className="loader" role="alertdialog" aria-busy="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LoaderBox {...loader} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="toasts" aria-live="polite">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div key={t.id} className={`toast${t.error ? ' error' : ''}`} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
                {t.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </AppCtx.Provider>
    </MotionConfig>
  );
}

function LoaderBox({ title, steps = [] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (steps.length < 2) return;
    const t = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 2600);
    return () => clearInterval(t);
  }, [steps]);
  return (
    <motion.div className="loader-box" initial={{ scale: 0.94, y: 8 }} animate={{ scale: 1, y: 0 }}>
      <div className="spinner">
        <img src="/logo.svg" alt="" />
      </div>
      <p className="loader-title">{title}</p>
      <AnimatePresence mode="wait">
        <motion.p key={i} className="loader-sub" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
          {steps[i] || ''}
        </motion.p>
      </AnimatePresence>
      {steps.length > 1 && (
        <div className="loader-steps" aria-hidden="true">
          {steps.map((_, k) => (
            <i key={k} className={k <= i ? 'on' : ''} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
