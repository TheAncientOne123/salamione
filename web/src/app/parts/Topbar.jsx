import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { pct } from '@shared/scoring.js';
import { api } from '../../lib/api.js';
import { Icon } from '../../lib/ui.jsx';
import { useApp } from '../App.jsx';

/** Menú desplegable que se cierra al hacer clic afuera o con Escape. */
export function Dropdown({ button, children, align = 'left', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className={`dd ${className}`} ref={ref}>
      {button({ open, toggle: () => setOpen((o) => !o) })}
      <AnimatePresence>
        {open && (
          <motion.div
            className={`menu ${align === 'right' ? 'menu-right' : ''}`}
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            onClick={(e) => e.target.closest('button,a') && setOpen(false)}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const TABS = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'fuentes', label: 'Fuentes', icon: 'file' },
  { id: 'versiones', label: 'Versiones', icon: 'layers' },
];

export default function Topbar() {
  const { snap, view, setView, setSnap, toast, confirm, openDialog, startTour, resetWorkspace } = useApp();
  const { ai, error } = snap.agent;
  const counts = { fuentes: snap.documents.length, versiones: snap.versions.length };

  const activate = async (id) => {
    if (id === snap.workspace.id) return;
    try {
      setSnap(await api('POST', `/api/workspaces/${id}/activate`));
    } catch (e) {
      toast(e.message, true);
    }
  };
  const remove = async () => {
    const w = snap.workspace;
    if (!(await confirm({ title: `¿Eliminar "${w.name}"?`, text: 'Se borran sus documentos, el análisis, las versiones y los archivos exportados. No se puede deshacer.', ok: 'Eliminar', danger: true }))) return;
    setSnap(await api('DELETE', `/api/workspaces/${w.id}`));
  };
  const logout = async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    location.href = '/login';
  };

  return (
    <header className="topbar">
      <div className="brand">
        <a href="/" className="brand-link" aria-label="SalamiOne, inicio">
          <img src="/logo.svg" alt="" width="32" height="32" />
          <span className="brand-name">
            Salami<span className="b-one">One</span>
          </span>
        </a>
        <Dropdown
          className="ws-wrap"
          button={({ toggle, open }) => (
            <button type="button" className="ws-btn" data-tour="workspace" onClick={toggle} aria-expanded={open} aria-haspopup="menu">
              <span className="ws-name">{snap.workspace.name}</span>
              <span className="ig-pill">IG{snap.workspace.ig}</span>
              <span aria-hidden="true">▾</span>
            </button>
          )}
        >
          <p className="menu-label">Tus evaluaciones</p>
          {snap.workspaces.map((w) => (
            <button key={w.id} type="button" role="menuitem" className={`ws-item${w.id === snap.workspace.id ? ' on' : ''}`} onClick={() => activate(w.id)}>
              <span className="ws-item-name">{w.name}</span>
              <span className="ws-item-meta">
                <span className="ig-pill">IG{w.ig}</span>
                {w.implementation != null ? pct(w.implementation) : w.documents ? `${w.documents} doc.` : 'vacía'}
              </span>
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" onClick={() => openDialog('ws-new')}>
            Nueva evaluación
          </button>
          <button type="button" role="menuitem" onClick={() => openDialog('ws-edit')}>
            Renombrar o cambiar IG
          </button>
          {snap.workspaces.length > 1 && (
            <button type="button" role="menuitem" className="danger" onClick={remove}>
              Eliminar esta evaluación
            </button>
          )}
        </Dropdown>
      </div>

      <nav className="tabs" role="tablist" data-tour="tabs">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={view === t.id} className={view === t.id ? 'on' : ''} onClick={() => setView(t.id)} data-tour={`tab-${t.id}`}>
            {view === t.id && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="tab-label">
              <Icon name={t.icon} size={16} />
              <span className="tab-text">{t.label}</span>
              {counts[t.id] > 0 && <span className="tab-count">{counts[t.id]}</span>}
            </span>
          </button>
        ))}
      </nav>

      <div className="topbar-right">
        <button
          type="button"
          className="ai-pill"
          data-tour="ai"
          onClick={() => openDialog('ai')}
          title={!ai.connected ? 'Sin IA conectada: se usa el motor demo. Haz clic para conectar tu modelo.' : error ? `IA no disponible: ${error.message}` : `Conectado: ${ai.label}`}
        >
          <span className={`status-dot ${ai.connected && !error ? 'ok' : 'warn'}`} />
          <span className="ai-text">{ai.connected ? `${ai.model}${ai.source === 'servidor' ? ' · servidor' : ''}` : 'Motor demo · conecta tu IA'}</span>
        </button>
        <Dropdown
          align="right"
          button={({ toggle, open }) => (
            <button type="button" className="avatar-btn" onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label="Menú de usuario">
              {(snap.user.name || '?').trim().charAt(0).toUpperCase()}
            </button>
          )}
        >
          <p className="menu-label">
            {snap.user.name} · {snap.user.email}
          </p>
          <button type="button" role="menuitem" onClick={() => openDialog('ai')}>
            Configuración de IA
          </button>
          <button type="button" role="menuitem" onClick={startTour}>
            Ver el tutorial
          </button>
          <button type="button" role="menuitem" onClick={resetWorkspace}>
            Vaciar esta evaluación
          </button>
          <div className="menu-sep" />
          <button type="button" role="menuitem" onClick={logout}>
            Cerrar sesión
          </button>
        </Dropdown>
      </div>
    </header>
  );
}
