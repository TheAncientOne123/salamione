import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { STATUS, APPLICABLE, APPLICABILITY, EFFORT, INIT_TYPE, fmt, pct } from '@shared/scoring.js';
import { api } from '../../lib/api.js';
import { CountUp, StatusChip, SeverityChip, RiskChip, InitChip, refText, Icon } from '../../lib/ui.jsx';
import { useApp } from '../App.jsx';

const rise = (k = 0) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay: 0.04 * k, ease: [0.16, 1, 0.3, 1] } });

export default function DashboardView() {
  const { snap, dashboard: d, setView, loadSample, pickFiles } = useApp();
  if (!d) {
    return (
      <div className="dash-inner">
        <motion.section className="card empty" {...rise()}>
          <img src="/logo.svg" alt="" width="72" height="72" />
          <h2>Todavía no hay dashboard</h2>
          <p className="muted">Sube un documento de contexto, describe tu organización en el chat o carga el caso de ejemplo.</p>
          <div className="row center">
            <button className="btn primary" onClick={() => pickFiles('contexto')}>
              Subir documento
            </button>
            <button className="btn" onClick={() => setView('chat')}>
              Ir al chat
            </button>
            <button className="btn ghost" onClick={() => loadSample('contexto')}>
              Caso de ejemplo
            </button>
          </div>
        </motion.section>
      </div>
    );
  }
  return (
    <div className="dash-inner">
      <Hero d={d} />
      <Indicators d={d} />
      <Counts d={d} />
      {snap.proposal && <Proposal p={snap.proposal} />}
      <Controls d={d} />
      <motion.section className="card" {...rise(6)}>
        <h2>Cinco riesgos principales</h2>
        <Risks d={d} />
      </motion.section>
      <motion.section className="card" {...rise(7)}>
        <h2>Roadmap de cinco iniciativas</h2>
        <Roadmap d={d} />
      </motion.section>
      <motion.section className="card" {...rise(8)}>
        <div className="card-head">
          <div>
            <h2>Ficha de contexto</h2>
            <p className="muted small">Cada afirmación tiene una cita verificada del documento. Lo que falta queda como restricción.</p>
          </div>
        </div>
        <Context ctx={d.context} />
      </motion.section>
      <Matrix d={d} />
    </div>
  );
}

function Hero({ d }) {
  const { snap, download, withLoader, setSnap, toast, saveVersion } = useApp();
  const { catalog, analysis } = snap;
  const st = d.stats || {};
  const summary = async () => {
    await withLoader('Generando el resumen ejecutivo…', ['Completando la plantilla carta…', 'Ajustando el contenido a una página…', 'Verificando que tenga una sola página…'], async () => {
      try {
        const r = await api('POST', '/api/export/summary', {});
        setSnap(r);
        const a = Object.assign(document.createElement('a'), { href: r.report.url, download: r.report.file });
        document.body.append(a);
        a.click();
        a.remove();
        toast(`Generado: ${r.report.file}`);
      } catch (e) {
        toast(e.message, true);
      }
    });
  };
  const igMismatch = (analysis.ig || 1) !== catalog.ig;
  return (
    <motion.section className="card hero" {...rise()}>
      <div className="hero-text">
        <p className="eyebrow">
          {catalog.shortName} · {catalog.safeguards.length} salvaguardas
        </p>
        <h2 className="hero-title">{d.company.name === 'No informado' ? snap.workspace.name : d.company.name}</h2>
        {d.company.sector !== 'No informado' && <p className="muted small">Sector: {d.company.sector}</p>}
        <ul className="summary">
          {d.summary.map((p, k) => (
            <li key={k}>{p}</li>
          ))}
        </ul>
        <p className="muted small">
          Evaluación: {new Date(d.generatedAt).toLocaleString('es')}
          {d.updatedAt && ` · actualizada: ${new Date(d.updatedAt).toLocaleString('es')}`} · motor: {d.engine}
          {st.quotes != null && ` · ${st.quotes - st.rejectedQuotes} citas verificadas, ${st.rejectedQuotes} descartadas`}
        </p>
        {analysis.warning && <p className="notice-inline small">⚠️ {analysis.warning} Se usó el motor de respaldo.</p>}
        {igMismatch && (
          <p className="notice-inline small">
            ⚠️ Esta evaluación se hizo con IG{analysis.ig || 1} y ahora el alcance es IG{catalog.ig}: las salvaguardas nuevas figuran como no verificadas hasta que rehagas la evaluación.
          </p>
        )}
      </div>
      <div className="hero-actions" data-tour="export">
        <p className="eyebrow">Exportar</p>
        <button className="btn primary" onClick={() => download('/api/export/dashboard.pdf', 'Generando el PDF del dashboard…')}>
          <Icon name="download" size={16} /> Dashboard en PDF
        </button>
        <button className="btn" onClick={() => download('/api/export/dashboard.xlsx', 'Generando el Excel…', ['Armando las hojas…'])}>
          <Icon name="download" size={16} /> Dashboard en Excel
        </button>
        <button className="btn accent" onClick={summary}>
          Resumen ejecutivo (1 página)
        </button>
        <button className="btn ghost" onClick={() => saveVersion(`Versión guardada · ${new Date().toLocaleDateString('es')}`)}>
          Guardar versión
        </button>
      </div>
    </motion.section>
  );
}

function Indicators({ d }) {
  const { snap } = useApp();
  const initial = d.updatedAt ? snap.versions.find((v) => v.reason === 'analisis')?.summary : null;
  const cards = [
    { label: `Cobertura IG${d.ig}`, value: d.coverage, suffix: '%', sub: `${d.evaluable} de ${d.total - d.counts.no_aplicable} salvaguardas con información suficiente`, before: initial?.coverage },
    { label: `Implementación IG${d.ig}`, value: d.implementation, suffix: '%', sub: `Sobre ${d.evaluable} evaluables · (I + 0,5·P) / (I + P + N)`, before: initial?.implementation, tone: d.label.key },
    { label: 'Riesgos prioritarios', value: d.risks.length, decimals: 0, sub: `${d.risks.filter((r) => r.state === 'vigente').length} vigentes · ${d.risks.filter((r) => r.state === 'reducido').length} reducidos · ${d.risks.filter((r) => r.state === 'mitigado').length} mitigados` },
    { label: 'Iniciativas', value: d.initiatives.length, decimals: 0, sub: `${d.initiatives.filter((i) => i.type === 'quick_win').length} quick wins · ${d.initiatives.filter((i) => i.progress.state !== 'pendiente').length} con avance` },
  ];
  return (
    <section className="inds">
      {cards.map((c, k) => (
        <motion.div key={c.label} className="card ind" {...rise(k + 1)}>
          <p className="kpi-label">{c.label}</p>
          <p className="ind-value">
            <CountUp value={c.value} suffix={c.suffix || ''} decimals={c.decimals ?? 1} />
          </p>
          {c.tone && <span className={`chip ${c.tone}`}>{d.label.label}</span>}
          <p className="kpi-sub">{c.sub}</p>
          {c.before != null && c.before !== c.value && <p className="kpi-sub">Inicial: {pct(c.before)}</p>}
        </motion.div>
      ))}
    </section>
  );
}

function Counts({ d }) {
  return (
    <motion.section className="count-strip card" {...rise(5)}>
      <div className="count-bar" aria-hidden="true">
        {Object.keys(STATUS).map((k) =>
          d.counts[k] ? (
            <motion.i key={k} className={`seg-${k}`} initial={{ width: 0 }} animate={{ width: `${(100 * d.counts[k]) / d.total}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
          ) : null
        )}
      </div>
      <div className="count-legend">
        {Object.entries(STATUS).map(([k, v]) => (
          <div key={k} className="count-item">
            <strong className="num">{d.counts[k]}</strong>
            <span className="count-label">
              <span className={`sq ${k}`} />
              {v.long}
            </span>
            {d.counts[k] !== d.baseCounts[k] && <small className="muted">{d.counts[k] - d.baseCounts[k] > 0 ? '+' : ''}{d.counts[k] - d.baseCounts[k]} por simulación</small>}
          </div>
        ))}
      </div>
    </motion.section>
  );
}

const DECISION = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado', sin_cambio: 'Sin cambio (evidencia insuficiente)' };

function Proposal({ p }) {
  const { setSnap, toast, confirm, pushMsg, setView } = useApp();
  const open = p.status === 'abierta';
  const counts = p.changes.reduce((a, c) => ((a[c.decision] = (a[c.decision] || 0) + 1), a), {});
  const decide = async (id, decision) => {
    try {
      setSnap(await api('PUT', `/api/proposal/changes/${encodeURIComponent(id)}`, { decision }));
    } catch (e) {
      toast(e.message, true);
    }
  };
  const apply = async () => {
    const n = counts.aprobado || 0;
    if (!(await confirm({ title: `¿Aplicar ${n} cambio(s) aprobado(s)?`, text: 'Los pendientes y rechazados no se aplican. La evaluación anterior se conserva como versión para comparar.', ok: 'Aplicar' }))) return;
    try {
      const r = await api('POST', '/api/proposal/apply');
      setSnap(r);
      pushMsg({
        role: 'assistant',
        content: `Apliqué ${n} cambio(s) aprobado(s) y guardé la **evaluación actualizada como v${r.applied.version}**. Abre **Versiones** para ver si la postura mejoró o empeoró.`,
        actions: [{ text: 'Diagnóstico actualizado', before: r.applied.before, after: r.applied.after, view: 'versiones' }],
      });
      toast(`Evaluación actualizada guardada como v${r.applied.version}.`);
      setView('versiones');
    } catch (e) {
      toast(e.message, true);
    }
  };
  const discard = async () => {
    if (open && !(await confirm({ title: '¿Descartar la propuesta?', text: 'No se aplicará ningún cambio.', ok: 'Descartar', danger: true }))) return;
    setSnap(await api('DELETE', '/api/proposal'));
  };
  const approveAll = async () => {
    for (const c of p.changes.filter((x) => x.decision === 'pendiente')) await decide(c.id, 'aprobado');
  };
  return (
    <motion.section className="card proposal" {...rise(5)}>
      <div className="card-head">
        <div>
          <h2>Actualización con nueva evidencia</h2>
          <p className="muted small">
            {open ? 'Pendiente de tu validación' : `Aplicada el ${new Date(p.appliedAt).toLocaleString('es')}`} · {p.documents.join(', ')} · {counts.aprobado || 0} aprobados, {counts.pendiente || 0} pendientes, {counts.rechazado || 0} rechazados
          </p>
        </div>
        <div className="row">
          {open && !!counts.pendiente && (
            <button className="btn ghost" onClick={approveAll}>
              Aprobar todos
            </button>
          )}
          <button className="btn" onClick={discard}>
            {open ? 'Descartar' : 'Ocultar'}
          </button>
          {open && (
            <button className="btn primary" onClick={apply} disabled={!counts.aprobado}>
              Aplicar aprobados
            </button>
          )}
        </div>
      </div>
      {!!p.initiatives.length && (
        <>
          <h3 className="sub-h">Iniciativas reportadas</h3>
          <div className="rep-grid">
            {p.initiatives.map((i, k) => (
              <div key={k} className="card rep">
                <p className="ctx-title">
                  {i.name} <span className={`chip ${i.completeness === 'completa' ? 'bajo' : 'medio'}`}>{i.completeness === 'completa' ? 'Completa' : 'Parcial'}</span>
                </p>
                <p className="small">
                  <strong>Qué mejoró:</strong> {i.improved || '—'}
                </p>
                <p className="small">
                  <strong>Salvaguardas:</strong> {i.safeguards.join(', ') || 'ninguna identificada'}
                </p>
                {i.pending && (
                  <p className="small">
                    <strong>Pendiente:</strong> {i.pending}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      <h3 className="sub-h">Cambios propuestos</h3>
      {!p.changes.length ? (
        <p className="muted small">La nueva evidencia no afecta ninguna salvaguarda.</p>
      ) : (
        <div className="change-list">
          {p.changes.map((c) => (
            <div key={c.id} className={`change dec-${c.decision}`}>
              <div className="change-head">
                <span className="sid">{c.id}</span>
                <span className="arrow-st">
                  <StatusChip status={c.from} /> → <StatusChip status={c.proposed} />
                </span>
                {open && c.decision !== 'sin_cambio' ? (
                  <div className="seg dec" role="radiogroup" aria-label={`Validación de ${c.id}`}>
                    {['aprobado', 'pendiente', 'rechazado'].map((k) => (
                      <button key={k} className={c.decision === k ? 'on' : ''} role="radio" aria-checked={c.decision === k} onClick={() => decide(c.id, k)}>
                        {{ aprobado: 'Aprobar', pendiente: 'Pendiente', rechazado: 'Rechazar' }[k]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="dec-label">{DECISION[c.decision]}</span>
                )}
              </div>
              <p className="small">{c.justification}</p>
              {c.pending && <p className="small muted">Pendiente: {c.pending}</p>}
              {c.evidence.slice(0, 2).map((e, k) => (
                <blockquote key={k} className="evidence">
                  “{e.quote}” <cite>— {refText(e)}</cite>
                </blockquote>
              ))}
            </div>
          ))}
        </div>
      )}
    </motion.section>
  );
}

function Controls({ d }) {
  const { snap } = useApp();
  const byId = Object.fromEntries(d.safeguards.map((s) => [s.id, s]));
  // La matriz escucha este evento: abre el control, resalta la salvaguarda y la lleva a la vista.
  const goto = (id) => window.dispatchEvent(new CustomEvent('s1-focus', { detail: id }));
  return (
    <motion.section className="card" {...rise(6)}>
      <div className="card-head">
        <div>
          <h2>Implementación por control</h2>
          <p className="muted small">
            {d.controls.length} controles · {d.total} salvaguardas. Cada celda es una salvaguarda: haz clic para ver su detalle.
          </p>
        </div>
        <div className="legend small">
          {Object.entries(STATUS).map(([k, v]) => (
            <span key={k}>
              <i className={`sq ${k}`} />
              {v.label}
            </span>
          ))}
        </div>
      </div>
      <div className="ctrl-grid">
        {d.controls.map((c, k) => (
          <motion.div key={c.id} className="card ctrl" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.02 * k }}>
            <div className="ctrl-head">
              <span className="ctrl-id">{c.id}</span>
              <span className="ctrl-name-text">{c.name}</span>
            </div>
            <div className="ctrl-score">
              <span className="val">{c.implementation == null ? 'N/D' : <>{fmt(c.implementation)}<small>%</small></>}</span>
              <span className={`chip ${c.label.key}`}>{c.label.label}</span>
            </div>
            <div className="ctrl-bar">
              <motion.div className="fill" style={{ background: `var(--s-${c.label.key})` }} initial={{ width: 0 }} animate={{ width: `${c.implementation ?? 0}%` }} transition={{ duration: 0.7, delay: 0.02 * k }} />
            </div>
            <div className="ctrl-cells">
              {c.safeguards.map((id) => {
                const s = byId[id];
                return (
                  <button key={id} className={`cell ${s.status}${s.overridden ? ' overridden' : ''}`} onClick={() => goto(id)} title={`${s.id} · ${s.title}: ${STATUS[s.status].long}${s.overridden ? ' (simulado)' : ''}`}>
                    {id}
                  </button>
                );
              })}
            </div>
            <div className="ctrl-foot">
              <span>Cobertura {pct(c.coverage)}</span>
            </div>
          </motion.div>
        ))}
      </div>
      {snap.catalog.scope && <p className="muted small">Alcance: {snap.catalog.scope}</p>}
    </motion.section>
  );
}

function Risks({ d }) {
  if (!d.risks.length) return <p className="muted small">No se identificaron riesgos con brechas confirmadas.</p>;
  return (
    <div className="risk-list">
      {d.risks.map((r) => (
        <div key={r.id} className="risk">
          <div className="risk-id">{r.id}</div>
          <div className="risk-body">
            <div className="risk-head">
              <strong>{r.title}</strong>
              <SeverityChip s={r.severity} />
              <RiskChip s={r.state} />
            </div>
            <p className="small">{r.description}</p>
            <p className="small muted">
              <b>Activo:</b> {r.asset} · <b>Consecuencia:</b> {r.consequence}
            </p>
            <p className="small muted">
              <b>Deficiencia:</b> {r.deficiency} · Salvaguardas {r.linked.map((s) => s.id).join(', ')}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Roadmap({ d }) {
  if (!d.initiatives.length) return <p className="muted small">Sin iniciativas propuestas.</p>;
  return (
    <div className="roadmap">
      {d.initiatives.map((i) => (
        <div key={i.id} className="init">
          <span className="init-n">{i.priority}</span>
          <div className="init-body">
            <div className="risk-head">
              <strong>{i.name}</strong>
              <span className={`type ${i.type}`}>{INIT_TYPE[i.type]}</span>
              <span className="chip nd">Esfuerzo {EFFORT[i.effort].toLowerCase()}</span>
            </div>
            <p className="small">{i.description}</p>
            <p className="small muted">
              {i.benefit} · Salvaguardas {i.safeguards.join(', ')}
              {i.risks.length ? ` · Riesgos ${i.risks.join(', ')}` : ''}
            </p>
          </div>
          <div className="init-progress">
            <InitChip p={i.progress} />
            <div className="mini-bar">
              <motion.i initial={{ width: 0 }} animate={{ width: `${i.progress.pct}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Context({ ctx }) {
  if (!ctx) return <p className="muted small">Sin ficha de contexto.</p>;
  return (
    <div className="ctx-grid">
      {ctx.dimensions.map((dim) => (
        <div key={dim.id} className={`ctx-dim${dim.id === 'restricciones' ? ' ctx-limits' : ''}`}>
          <p className="ctx-title">{dim.name}</p>
          {!!dim.findings.length && (
            <ul className="ctx-list">
              {dim.findings.map((f, k) => (
                <li key={k}>
                  {f.statement} <span className="ctx-ref">[{refText(f.evidence[0])}]</span>
                </li>
              ))}
            </ul>
          )}
          {!!dim.missing.length && (
            <ul className="ctx-list ctx-missing">
              {dim.missing.map((m, k) => (
                <li key={k}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

const FILTERS = [
  ['all', 'Todas'],
  ['gaps', 'Brechas'],
  ['no_verificado', 'No verificadas'],
  ['updated', 'Actualizadas'],
  ['applied', 'Simuladas'],
];

function Matrix({ d }) {
  const { setSafeguard, sendChat, setView } = useApp();
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(() => new Set());
  const [flash, setFlash] = useState(null);
  const byId = Object.fromEntries(d.safeguards.map((s) => [s.id, s]));

  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  // Clic en una celda del mapa: abre su control y resalta la salvaguarda.
  useEffect(() => {
    const timers = [];
    const onFocus = (e) => {
      const s = byIdRef.current[e.detail];
      if (!s) return;
      setFilter('all');
      setOpen((o) => new Set(o).add(s.controlId));
      setFlash(e.detail);
      timers.push(setTimeout(() => document.getElementById(`sg-${e.detail.replace('.', '-')}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300));
      timers.push(setTimeout(() => setFlash(null), 2000));
    };
    window.addEventListener('s1-focus', onFocus);
    return () => {
      window.removeEventListener('s1-focus', onFocus);
      timers.forEach(clearTimeout);
    };
  }, []);

  const keep = (s) =>
    filter === 'all' ||
    (filter === 'gaps' && (s.status === 'no_implementado' || s.status === 'parcial')) ||
    (filter === 'applied' && s.overridden) ||
    (filter === 'updated' && s.history.length) ||
    filter === s.status;
  const toggle = (id) => setOpen((o) => {
    const n = new Set(o);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const groups = d.controls.map((c) => ({ c, items: c.safeguards.map((id) => byId[id]).filter(keep) })).filter((g) => g.items.length);

  return (
    <motion.section className="card" {...rise(9)}>
      <div className="card-head">
        <div>
          <h2>Matriz de las {d.total} salvaguardas</h2>
          <p className="muted small">Estado según evidencia, con citas verificadas. Los botones simulan controles aplicados (no reemplazan la evidencia).</p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Filtrar salvaguardas">
          {FILTERS.map(([k, label]) => (
            <button key={k} className={filter === k ? 'on' : ''} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="sg-groups">
        {!groups.length && <p className="muted small">No hay salvaguardas en esta vista.</p>}
        {groups.map(({ c, items }) => {
          const isOpen = filter !== 'all' || open.has(c.id);
          return (
            <div key={c.id} className={`sg-group${isOpen ? ' open' : ''}`}>
              <button className="sg-summary" onClick={() => toggle(c.id)} aria-expanded={isOpen}>
                <span className="g-title">
                  {c.id}. {c.name}
                </span>
                <span className="g-meta">
                  <span>
                    {c.safeguards.length} salvaguarda{c.safeguards.length > 1 ? 's' : ''} · cobertura {pct(c.coverage)}
                  </span>
                  <span className={`chip ${c.label.key}`}>{c.implementation == null ? 'N/D' : `${fmt(c.implementation)}%`}</span>
                  <motion.span animate={{ rotate: isOpen ? 90 : 0 }} className="caret" aria-hidden="true">
                    ›
                  </motion.span>
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} style={{ overflow: 'hidden' }}>
                    {items.map((s) => (
                      <Safeguard
                        key={s.id}
                        s={s}
                        flash={flash === s.id}
                        onSet={(st) => setSafeguard(s.id, st)}
                        onAsk={() => {
                          setView('chat');
                          sendChat(`Cuéntame sobre la salvaguarda ${s.id} (${s.title}): qué evidencia hay, por qué tiene ese estado y qué faltaría.`);
                        }}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}

function Safeguard({ s, flash, onSet, onAsk }) {
  return (
    <div className={`sg${flash ? ' flash' : ''}`} id={`sg-${s.id.replace('.', '-')}`}>
      <div>
        <div className="sg-title">
          <span className="sid">{s.id}</span>
          {s.title}
          <span className="ig-pill soft">IG{s.ig || 1}</span>
        </div>
        <div className="sg-desc">{s.description}</div>
        <div className="sg-doc">
          Aplicabilidad: <strong>{APPLICABILITY[s.applicability]}</strong> · Según evidencia: <StatusChip status={s.documented} long />
          {s.downgraded && <span title="La cita del agente no se encontró en el documento."> (cita no verificada)</span>}
        </div>
        {s.rationale && (
          <div className="sg-why">
            <strong>Justificación:</strong> {s.rationale}
          </div>
        )}
        {s.observations && (
          <div className="sg-why">
            <strong>Observaciones:</strong> {s.observations}
          </div>
        )}
        {s.evidence.map((e, k) => (
          <blockquote key={k} className="evidence">
            “{e.quote}” <cite>— {refText(e)}</cite>
          </blockquote>
        ))}
        {s.history.map((h, k) => (
          <div key={k} className="sg-hist">
            ↻ {new Date(h.at).toLocaleDateString('es')}: {STATUS[h.from]?.long || h.from} → {STATUS[h.to]?.long || h.to} ({h.documents.join(', ')})
          </div>
        ))}
      </div>
      <div className="sg-side">
        <div className="seg" role="radiogroup" aria-label={`Simular estado de ${s.id}`}>
          {APPLICABLE.map((k) => (
            <button key={k} className={s.status === k ? 'on' : ''} role="radio" aria-checked={s.status === k} onClick={() => onSet(k)}>
              {STATUS[k].label}
            </button>
          ))}
        </div>
        {s.overridden && (
          <button className="reset-link" onClick={() => onSet('documentado')}>
            Volver a la evidencia
          </button>
        )}
        {s.gain > 0 && (
          <div className="gain">
            <span className="delta-up">+{fmt(s.gain)} pts</span>
            <small>de implementación si se implementa</small>
          </div>
        )}
        <button className="ask-btn" onClick={onAsk}>
          Preguntar en el chat
        </button>
      </div>
    </div>
  );
}
