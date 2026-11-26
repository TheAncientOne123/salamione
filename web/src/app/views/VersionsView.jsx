import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { STATUS, SEVERITY, RISK_STATE, pct, fmt } from '@shared/scoring.js';
import { versionSummary, compareVersions } from '@shared/versions.js';
import { api } from '../../lib/api.js';
import { CountUp, Icon } from '../../lib/ui.jsx';
import { useApp } from '../App.jsx';

const REASON = { analisis: 'Evaluación inicial', actualizacion: 'Actualizada con evidencia', manual: 'Guardada a mano' };
const fdate = (iso) => new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
const STEPS = ['Versión anterior', 'Versión nueva', 'Cambios'];

const slide = {
  initial: (dir) => ({ opacity: 0, x: dir * 40 }),
  animate: { opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
  exit: (dir) => ({ opacity: 0, x: dir * -40, transition: { duration: 0.18 } }),
};

export default function VersionsView() {
  const { snap, dashboard: d, setView } = useApp();
  const vs = snap.versions;
  const [phase, setPhase] = useState(1);
  const [dir, setDir] = useState(1);
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);

  const items = useMemo(() => {
    const list = [...vs].reverse().map((v) => ({ key: v.id, n: v.n, title: v.label, reason: REASON[v.reason] || v.reason, date: v.createdAt, summary: v.summary, version: v }));
    return list;
  }, [vs]);
  const current = d ? { key: 'current', n: null, title: 'Estado actual', reason: 'Sin guardar (incluye simulaciones)', date: null, summary: versionSummary(d) } : null;
  const find = (k) => (k === 'current' ? current : items.find((x) => x.key === k));

  const go = (p) => {
    setDir(p > phase ? 1 : -1);
    setPhase(p);
  };

  if (!vs.length) {
    return (
      <div className="dash-inner">
        <section className="card empty">
          <img src="/logo.svg" alt="" width="72" height="72" />
          <h2>Todavía no hay versiones</h2>
          <p className="muted">La primera evaluación se guarda sola como versión. Después sube nueva evidencia o rehaz la evaluación con documentos actualizados y compara el antes y el después.</p>
          <button className="btn primary" onClick={() => setView('chat')}>
            Ir al chat
          </button>
        </section>
      </div>
    );
  }

  const A = find(a);
  const B = find(b);

  return (
    <div className="dash-inner versions">
      <header className="page-head">
        <div>
          <p className="eyebrow">Versiones</p>
          <h1>Antes y después</h1>
          <p className="muted">Elige la versión anterior, después la nueva, y SalamiOne te muestra qué cambió y si la postura mejoró o empeoró.</p>
        </div>
      </header>

      <ol className="stepper" aria-label="Fases de la comparación">
        {STEPS.map((label, k) => {
          const n = k + 1;
          const done = n < phase;
          const can = n === 1 || (n === 2 && A) || (n === 3 && A && B);
          return (
            <li key={label} className={`step${phase === n ? ' on' : ''}${done ? ' done' : ''}`}>
              <button disabled={!can} onClick={() => can && go(n)} aria-current={phase === n ? 'step' : undefined}>
                <span className="step-n">{done ? <Icon name="check" size={14} /> : n}</span>
                <span className="step-text">
                  <span className="step-label">{label}</span>
                  <span className="step-value">{n === 1 && A ? (A.n ? `v${A.n}` : 'Estado actual') : n === 2 && B ? (B.n ? `v${B.n}` : 'Estado actual') : n === 3 && A && B ? 'Listo' : '—'}</span>
                </span>
              </button>
              {k < 2 && <span className={`step-line${done ? ' done' : ''}`} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      <div className="phase-host">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          {phase === 1 && (
            <motion.div key="p1" custom={dir} variants={slide} initial="initial" animate="animate" exit="exit">
              <PhaseOne
                items={items}
                selected={a}
                onPick={(k) => {
                  setA(k);
                  if (b === k) setB(null);
                }}
                onNext={() => go(2)}
              />
            </motion.div>
          )}
          {phase === 2 && A && (
            <motion.div key="p2" custom={dir} variants={slide} initial="initial" animate="animate" exit="exit">
              <PhaseTwo
                A={A}
                items={[...(current ? [current] : []), ...items].filter((x) => x.key !== a)}
                selected={b}
                onBack={() => go(1)}
                onPick={(k) => setB(k)}
                onNext={() => go(3)}
              />
            </motion.div>
          )}
          {phase === 3 && A && B && (
            <motion.div key="p3" custom={dir} variants={slide} initial="initial" animate="animate" exit="exit">
              <PhaseThree A={A} B={B} onChangeA={() => go(1)} onChangeB={() => go(2)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------- tarjeta de versión ----------

function VersionCard({ it, selected, onPick, tag, actions, dim }) {
  return (
    <motion.div layout className={`vcard${selected ? ' selected' : ''}${dim ? ' dim' : ''}`} whileHover={{ y: -2 }}>
      <button className="vcard-main" onClick={onPick} role="radio" aria-checked={!!selected}>
        <span className={`vbadge${it.n ? '' : ' live'}`}>{it.n ? `v${it.n}` : 'Ahora'}</span>
        <span className="vcard-text">
          <span className="vcard-title">{it.title}</span>
          <span className="vcard-meta">
            {it.reason}
            {it.date && ` · ${fdate(it.date)}`}
            {tag && <span className="vtag">{tag}</span>}
          </span>
        </span>
        <span className="vcard-figs">
          <span className="vcard-big">{pct(it.summary.implementation)}</span>
          <span className="vcard-small">implementación · cobertura {pct(it.summary.coverage)}</span>
        </span>
        <span className={`vcard-check${selected ? ' on' : ''}`} aria-hidden="true">
          <AnimatePresence>
            {selected && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>
                <Icon name="check" size={14} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </button>
      {actions}
    </motion.div>
  );
}

function VersionActions({ v }) {
  const { download, confirm, setSnap, toast } = useApp();
  const restore = async () => {
    if (!(await confirm({ title: `¿Restaurar v${v.n}?`, text: `El dashboard vuelve a "${v.label}". Los documentos no cambian y las demás versiones se conservan.`, ok: 'Restaurar' }))) return;
    try {
      setSnap(await api('POST', `/api/versions/${v.id}/restore`));
      toast(`Restaurada v${v.n}.`);
    } catch (e) {
      toast(e.message, true);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: `¿Eliminar la versión v${v.n}?`, text: v.label, ok: 'Eliminar', danger: true }))) return;
    setSnap(await api('DELETE', `/api/versions/${v.id}`));
  };
  return (
    <div className="vcard-actions">
      <button className="chip-btn" onClick={() => download(`/api/export/dashboard.pdf?version=${v.id}`, 'Generando el PDF…')}>
        PDF
      </button>
      <button className="chip-btn" onClick={() => download(`/api/export/dashboard.xlsx?version=${v.id}`, 'Generando el Excel…', ['Armando las hojas…'])}>
        Excel
      </button>
      <button className="chip-btn" onClick={restore}>
        <Icon name="restore" size={14} /> Restaurar
      </button>
      <button className="chip-btn danger" onClick={remove} aria-label={`Eliminar v${v.n}`}>
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
}

// ---------- fase 1 ----------

function PhaseOne({ items, selected, onPick, onNext }) {
  const { saveVersion, dashboard } = useApp();
  const [name, setName] = useState('');
  return (
    <section className="phase">
      <div className="phase-head">
        <div>
          <h2>¿Desde qué versión partes?</h2>
          <p className="muted">Es el punto de referencia: normalmente la evaluación inicial o la última versión aprobada.</p>
        </div>
        {dashboard && (
          <form
            className="save-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await saveVersion(name || `Versión guardada · ${new Date().toLocaleDateString('es')}`);
              setName('');
            }}
          >
            <input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (p. ej. Después de MFA)" aria-label="Nombre de la versión" />
            <button className="btn" type="submit">
              Guardar estado actual
            </button>
          </form>
        )}
      </div>
      <div className="vlist">
        {items.map((it, k) => (
          <motion.div key={it.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.04 * k } }}>
            <VersionCard it={it} selected={selected === it.key} onPick={() => onPick(it.key)} tag={k === items.length - 1 ? 'la más antigua' : k === 0 ? 'la más reciente' : null} actions={<VersionActions v={it.version} />} />
          </motion.div>
        ))}
      </div>
      <NextBar picked={items.find((x) => x.key === selected)} hint="Elige la versión de referencia (antes)." onNext={onNext} label="Siguiente" />
    </section>
  );
}

// ---------- fase 2 ----------

function PhaseTwo({ A, items, selected, onPick, onBack, onNext }) {
  const newer = (it) => !it.date || !A.date || it.date > A.date;
  return (
    <section className="phase">
      <div className="phase-head">
        <div>
          <h2>¿Con qué versión la comparas?</h2>
          <p className="muted">
            Partes de <b>{A.n ? `v${A.n} · ${A.title}` : A.title}</b> ({pct(A.summary.implementation)}). Elige la versión que quieres evaluar contra ella.
          </p>
        </div>
      </div>
      <div className="vlist">
        {items.map((it, k) => (
          <motion.div key={it.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.04 * k } }}>
            <VersionCard it={it} selected={selected === it.key} onPick={() => onPick(it.key)} dim={!newer(it)} tag={!newer(it) ? 'anterior a la elegida' : null} />
          </motion.div>
        ))}
      </div>
      <NextBar picked={items.find((x) => x.key === selected)} hint="Elige la versión que quieres comparar (después)." onNext={onNext} onBack={onBack} label="Ver cambios" />
    </section>
  );
}

// ---------- barra para avanzar ----------

function NextBar({ picked, hint, onNext, onBack, label }) {
  return (
    <div className="next-bar">
      <div className="next-info" aria-live="polite">
        {picked ? (
          <>
            <span className="next-k">Seleccionada</span>
            <span className="next-v">
              {picked.n ? `v${picked.n} · ` : ''}
              {picked.title} · {pct(picked.summary.implementation)}
            </span>
          </>
        ) : (
          <span className="muted">{hint}</span>
        )}
      </div>
      <div className="row">
        {onBack && (
          <button className="btn ghost" onClick={onBack}>
            <Icon name="back" size={16} /> Anterior
          </button>
        )}
        <motion.button className="btn primary" disabled={!picked} onClick={onNext} whileTap={{ scale: 0.97 }}>
          {label} <Icon name="arrow" size={16} />
        </motion.button>
      </div>
    </div>
  );
}

// ---------- fase 3 ----------

const VERDICT_ICON = { mejora: 'up', retroceso: 'down', mixto: 'swap', sin_cambios: 'check' };

function PhaseThree({ A, B, onChangeA, onChangeB }) {
  const { download } = useApp();
  const c = useMemo(() => compareVersions(A.summary, B.summary), [A, B]);
  const better = c.changes.filter((x) => x.direction === 'mejora');
  const worse = c.changes.filter((x) => x.direction === 'retroceso');
  const other = c.changes.filter((x) => !['mejora', 'retroceso'].includes(x.direction));
  const ctrls = c.controls.filter((x) => x.delta);
  const risks = c.risks;
  const tabs = [
    { k: 'mejora', label: 'Mejoraron', n: better.length },
    { k: 'retroceso', label: 'Empeoraron', n: worse.length },
    { k: 'controles', label: 'Controles', n: ctrls.length },
    { k: 'riesgos', label: 'Riesgos', n: risks.filter((r) => r.changed).length },
    ...(other.length ? [{ k: 'otros', label: 'Otros cambios', n: other.length }] : []),
  ];
  const [tab, setTab] = useState(worse.length && !better.length ? 'retroceso' : 'mejora');
  const q = `a=${encodeURIComponent(A.key)}&b=${encodeURIComponent(B.key)}`;
  const label = (X) => (X.n ? `v${X.n}` : 'Estado actual');

  return (
    <section className="phase">
      <div className="phase-head">
        <div className="pair">
          <button className="pair-pill" onClick={onChangeA} title="Cambiar la versión anterior">
            <span className="pair-k">Antes</span> {label(A)}
          </button>
          <Icon name="arrow" size={18} />
          <button className="pair-pill" onClick={onChangeB} title="Cambiar la versión nueva">
            <span className="pair-k">Después</span> {label(B)}
          </button>
        </div>
        <div className="row">
          <button className="btn" onClick={() => download(`/api/export/compare.pdf?${q}`, 'Generando el PDF de la comparación…')}>
            <Icon name="download" size={16} /> PDF
          </button>
          <button className="btn" onClick={() => download(`/api/export/compare.xlsx?${q}`, 'Generando el Excel…', ['Armando las hojas…'])}>
            <Icon name="download" size={16} /> Excel
          </button>
        </div>
      </div>

      <motion.div className={`verdict-hero v-${c.verdict.key}`} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 22 }}>
        <motion.span className="verdict-icon" initial={{ rotate: -30, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 14 }}>
          <Icon name={VERDICT_ICON[c.verdict.key]} size={30} />
        </motion.span>
        <div>
          <p className="verdict-word">{c.verdict.label}</p>
          <p className="verdict-text">{c.verdict.text}</p>
        </div>
      </motion.div>

      <div className="delta-tiles">
        <DeltaTile label="Implementación" a={c.implementation.a} b={c.implementation.b} delta={c.implementation.delta} />
        <DeltaTile label="Cobertura" a={c.coverage.a} b={c.coverage.b} delta={c.coverage.delta} />
        <div className="tile">
          <p className="tile-label">Salvaguardas</p>
          <div className="tile-split">
            <span className="up">
              <Icon name="up" size={16} />
              <CountUp value={c.improved} decimals={0} /> mejoraron
            </span>
            <span className="down">
              <Icon name="down" size={16} />
              <CountUp value={c.worsened} decimals={0} /> empeoraron
            </span>
          </div>
        </div>
      </div>

      <div className="detail">
        <div className="detail-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>
              {tab === t.k && <motion.span layoutId="detail-pill" className="detail-pill" />}
              <span className="rel">
                {t.label} <span className="count-pill">{t.n}</span>
              </span>
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {tab === 'mejora' && <ChangeList list={better} empty="Ninguna salvaguarda mejoró." />}
            {tab === 'retroceso' && <ChangeList list={worse} empty="Ninguna salvaguarda empeoró." />}
            {tab === 'otros' && <ChangeList list={other} empty="Sin otros cambios." note="Pasar de No verificado a No implementado aporta certeza: no es mejora ni retroceso." />}
            {tab === 'controles' &&
              (ctrls.length ? (
                <ul className="clist">
                  {ctrls.map((x) => (
                    <li key={x.id} className="crow">
                      <span className="crow-name">
                        <b>{x.id}.</b> {x.name}
                      </span>
                      <span className="crow-vals num">
                        {x.a == null ? 'N/D' : `${fmt(x.a)}%`} → {x.b == null ? 'N/D' : `${fmt(x.b)}%`}
                      </span>
                      <span className={`crow-delta num ${x.delta > 0 ? 'up' : 'down'}`}>
                        {x.delta > 0 ? '+' : ''}
                        {fmt(x.delta)} pts
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted empty-line">Ningún control cambió su implementación.</p>
              ))}
            {tab === 'riesgos' &&
              (risks.length ? (
                <ul className="clist">
                  {risks.map((r) => (
                    <li key={r.id} className="crow">
                      <span className="crow-name">
                        <b>{r.id}</b> {r.title} <span className="muted small">· severidad {SEVERITY[r.severity]?.toLowerCase()}</span>
                      </span>
                      <span className="crow-vals">
                        {RISK_STATE[r.from]} → {r.to ? RISK_STATE[r.to] : '—'}
                      </span>
                      <span className={`crow-delta ${r.changed ? 'up' : 'flat'}`}>{r.changed ? 'Cambió' : 'Permanece'}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted empty-line">No hay riesgos para comparar.</p>
              ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

function DeltaTile({ label, a, b, delta }) {
  return (
    <div className="tile">
      <p className="tile-label">{label}</p>
      <p className="tile-main">
        <span className="tile-from num">{pct(a)}</span>
        <Icon name="arrow" size={16} />
        <span className="tile-to">
          <CountUp value={b} suffix="%" />
        </span>
      </p>
      <p className={`tile-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}`}>{delta == null ? 'Sin dato' : delta === 0 ? 'Sin variación' : <CountUp value={delta} suffix=" pts" signed />}</p>
    </div>
  );
}

function ChangeList({ list, empty, note }) {
  if (!list.length) return <p className="muted empty-line">{empty}</p>;
  return (
    <>
      {note && <p className="muted small">{note}</p>}
      <ul className="clist">
        {list.map((x, k) => (
          <motion.li key={x.id} className="crow" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0, transition: { delay: Math.min(k, 12) * 0.025 } }}>
            <span className="crow-name">
              <span className="sid">{x.id}</span> {x.title}
              {x.applied && <span className="muted small"> · simulado</span>}
            </span>
            <span className="crow-vals">
              <span className={`dot ${x.from}`} />
              {x.from ? STATUS[x.from].label : '—'} <Icon name="arrow" size={12} /> <span className={`dot ${x.to}`} />
              {x.to ? STATUS[x.to].label : '—'}
            </span>
          </motion.li>
        ))}
      </ul>
    </>
  );
}
