import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../lib/api.js';
import { Icon } from '../../lib/ui.jsx';
import { useApp } from '../App.jsx';
import { Modal } from '../parts/Dialogs.jsx';

const GROUPS = [
  { key: 'contexto', title: 'Documentos de contexto', text: 'Base de la evaluación: políticas, informes, inventarios. Cambiarlos requiere rehacer la evaluación.' },
  { key: 'chat', title: 'Descripciones del chat', text: 'Lo que escribiste en el chat para generar el dashboard.' },
  { key: 'evidencia', title: 'Nueva evidencia', text: 'Avances o cambios. Generan propuestas de actualización que validas en el dashboard.' },
];

const ext = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || 'txt').toUpperCase();
const size = (chars) => (chars > 1e6 ? `${(chars / 1e6).toFixed(1)} M` : chars > 1000 ? `${Math.round(chars / 1000)} mil` : chars) + ' caracteres';

export default function SourcesView() {
  const { snap, setSnap, toast, confirm, pickFiles, openDialog, loadSample, runAnalysis, download, uploadFiles } = useApp();
  const [viewing, setViewing] = useState(null);
  const [drag, setDrag] = useState(false);
  const { documents, analysis, versions, proposal } = snap;

  // Dónde se usó cada documento: evaluación actual, actualizaciones y versiones guardadas.
  const usage = (d) => {
    const inAnalysis = analysis?.documents?.includes(d.name) || analysis?.updates?.some((u) => u.documents.includes(d.name));
    const inVersions = versions.filter((v) => v.documents?.includes(d.name) || v.label.includes(d.name)).map((v) => `v${v.n}`);
    const inProposal = proposal?.status === 'abierta' && proposal.documents.includes(d.name);
    return { inAnalysis, inVersions, inProposal };
  };
  const groupOf = (d) => (d.source === 'chat' ? 'chat' : d.role === 'evidencia' ? 'evidencia' : 'contexto');
  const pendingContext = documents.filter((d) => groupOf(d) !== 'evidencia' && !usage(d).inAnalysis);

  const remove = async (d) => {
    const u = usage(d);
    const ok = await confirm({
      title: `¿Eliminar "${d.name}"?`,
      text: u.inAnalysis
        ? 'Esta fuente forma parte de la evaluación actual. Las versiones guardadas conservan sus resultados; para que el dashboard deje de usarla, rehaz la evaluación.'
        : 'Se quita de las fuentes de esta evaluación.',
      ok: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      setSnap(await api('DELETE', `/api/documents/${d.id}`));
      toast(`Eliminado: ${d.name}`);
    } catch (e) {
      toast(e.message, true);
    }
  };

  const open = async (d) => {
    try {
      setViewing(await api('GET', `/api/documents/${d.id}`));
    } catch (e) {
      toast(e.message, true);
    }
  };

  return (
    <div className="dash-inner sources">
      <motion.header className="page-head" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <p className="eyebrow">Fuentes de la evaluación</p>
          <h1>Fuentes</h1>
          <p className="muted">
            Todo lo que SalamiOne usa como evidencia en <b>{snap.workspace.name}</b>. Revisa el texto que se extrajo de cada archivo: si algo no se leyó bien, la evaluación tampoco lo verá.
          </p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => pickFiles('contexto')}>
            <Icon name="upload" size={16} /> Subir documento
          </button>
          <button className="btn" onClick={() => openDialog('paste')}>
            <Icon name="paste" size={16} /> Pegar texto
          </button>
          <button className="btn" onClick={() => pickFiles('evidencia')} disabled={!analysis} title={analysis ? '' : 'Disponible después de la primera evaluación'}>
            Nueva evidencia
          </button>
        </div>
      </motion.header>

      <AnimatePresence>
        {pendingContext.length > 0 && (
          <motion.div className="banner" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <span>
              {pendingContext.length === 1 ? `"${pendingContext[0].name}" todavía no está` : `${pendingContext.length} fuentes todavía no están`} en la evaluación.
            </span>
            <button className="btn accent small" onClick={() => runAnalysis()}>
              {analysis ? 'Rehacer evaluación con todas las fuentes' : 'Analizar ahora'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={`dropzone${drag ? ' on' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files], 'contexto');
        }}
      >
        <Icon name="upload" size={22} />
        <span>
          Arrastra archivos aquí ({snap.agent.supported.map((x) => x.slice(1).toUpperCase()).join(', ')}) o{' '}
          <button className="link-btn" onClick={() => pickFiles('contexto')}>
            elígelos
          </button>
          .
        </span>
      </div>

      {!documents.length && (
        <section className="card empty">
          <h2>Todavía no hay fuentes</h2>
          <p className="muted">Sube un documento, pega texto, describe la organización en el chat o prueba con el caso de ejemplo.</p>
          <button className="btn" onClick={() => loadSample('contexto')}>
            Cargar caso de ejemplo
          </button>
        </section>
      )}

      {GROUPS.map((g) => {
        const list = documents.filter((d) => groupOf(d) === g.key);
        if (!list.length) return null;
        return (
          <section key={g.key} className="src-group">
            <div className="src-group-head">
              <h2>
                {g.title} <span className="count-pill">{list.length}</span>
              </h2>
              <p className="muted small">{g.text}</p>
            </div>
            <ul className="src-list">
              <AnimatePresence initial={false}>
                {list.map((d, k) => {
                  const u = usage(d);
                  return (
                    <motion.li key={d.id} className="src" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.03 * k } }} exit={{ opacity: 0, x: -20 }}>
                      <span className={`src-type t-${g.key}`}>{d.source === 'chat' ? 'CHAT' : d.source === 'texto' ? 'TEXTO' : ext(d.name)}</span>
                      <div className="src-main">
                        <button className="src-name" onClick={() => open(d)} title="Ver el texto extraído">
                          {d.name}
                        </button>
                        <div className="src-meta">
                          <span>{new Date(d.uploadedAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          <span>{size(d.chars)}</span>
                          {u.inAnalysis ? <span className="tag ok">En la evaluación actual</span> : g.key !== 'evidencia' && <span className="tag warn">Sin analizar</span>}
                          {u.inProposal && <span className="tag warn">Propuesta pendiente</span>}
                          {u.inVersions.length > 0 && <span className="tag">Versiones {u.inVersions.join(', ')}</span>}
                        </div>
                        <p className="src-preview">{d.preview}</p>
                      </div>
                      <div className="src-actions">
                        <button className="icon-btn" onClick={() => open(d)} title="Ver texto extraído" aria-label={`Ver ${d.name}`}>
                          <Icon name="eye" />
                        </button>
                        <button className="icon-btn" onClick={() => download(`/api/documents/${d.id}/text`, 'Preparando el texto…', [])} title="Descargar texto (.txt)" aria-label={`Descargar ${d.name}`}>
                          <Icon name="download" />
                        </button>
                        <button className="icon-btn danger" onClick={() => remove(d)} title="Eliminar" aria-label={`Eliminar ${d.name}`}>
                          <Icon name="trash" />
                        </button>
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </section>
        );
      })}

      <AnimatePresence>{viewing && <DocViewer key="viewer" doc={viewing} onClose={() => setViewing(null)} />}</AnimatePresence>
    </div>
  );
}

function DocViewer({ doc, onClose }) {
  const [q, setQ] = useState('');
  const parts = doc.text.split(/\[\[Página (\d+)\]\]\n?/);
  // parts: [antes, '1', texto1, '2', texto2…] en PDF; un solo bloque en otros formatos.
  const pages = parts.length > 1 ? Array.from({ length: (parts.length - 1) / 2 }, (_, k) => ({ n: parts[1 + 2 * k], text: parts[2 + 2 * k] })) : [{ n: null, text: doc.text }];
  const mark = (t) => {
    if (q.trim().length < 2) return t;
    const re = new RegExp(`(${q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return t.split(re).map((x, k) => (k % 2 ? <mark key={k}>{x}</mark> : x));
  };
  const hits = q.trim().length >= 2 ? (doc.text.match(new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length : null;
  return (
    <Modal title={doc.name} onClose={onClose} wide>
      <p className="muted small">
        {doc.role === 'evidencia' ? 'Nueva evidencia' : 'Contexto'} · {doc.pages ? `${doc.pages} páginas · ` : ''}
        {doc.chars.toLocaleString('es')} caracteres · Este es el texto exacto contra el que se verifican las citas.
      </p>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el documento…" aria-label="Buscar en el documento" />
      {hits != null && <p className="small muted">{hits} coincidencia{hits === 1 ? '' : 's'}</p>}
      <div className="doc-text">
        {pages.map((p, k) => (
          <div key={k} className="doc-page">
            {p.n && <p className="doc-page-n">Página {p.n}</p>}
            <pre>{mark(p.text)}</pre>
          </div>
        ))}
      </div>
      <div className="row end">
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
