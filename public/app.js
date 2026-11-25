import { computeDashboard, fmt, pct, STATUS, APPLICABLE, APPLICABILITY } from './scoring.js';
import {
  esc,
  statusChip,
  legend,
  kpiCards,
  indicatorCards,
  controlCard,
  evidenceHtml,
  contextHtml,
  risksTable,
  roadmapTable,
  changesTable,
  reportedInitiatives,
  riskStateChip,
  severityChip,
} from './components.js';
import { versionSummary, compareVersions } from './versions.js';
import { startTour } from './tour.js';

const $ = (s) => document.querySelector(s);

// Preferencias locales del navegador (pueden no estar disponibles).
const local = {
  get(k, def) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const ui = {
  snap: null,
  overrides: {},
  view: ['#chat', '#dashboard', '#versions'].includes(location.hash) ? location.hash.slice(1) : local.get('s1-view', 'chat'),
  sfilter: 'all',
  open: new Set(),
  chat: [],
  wsId: null,
  busy: false,
  lastErrorAt: null,
  uploadRole: 'contexto',
  cmpA: null,
  cmpB: null,
  cmpAllControls: false,
};

// ---------------- API ----------------

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Sesión expirada.');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function setSnap(snap) {
  const changedWs = ui.wsId !== snap.workspace.id;
  ui.snap = snap;
  ui.overrides = { ...snap.overrides };
  if (changedWs) {
    ui.wsId = snap.workspace.id;
    ui.chat = local.get(`s1-chat-${ui.wsId}`, []);
    ui.open.clear();
    ui.cmpA = ui.cmpB = null;
    renderChat();
  }
  render();
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (error ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), error ? 7000 : 3500);
}

/** Confirmación con diálogo propio (devuelve una promesa). */
function askConfirm(title, text, ok = 'Continuar', danger = false) {
  const d = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = ok;
  $('#confirm-ok').className = `btn ${danger ? 'danger' : 'primary'}`;
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true }));
}

// ---------------- Carga a pantalla completa ----------------

let loaderTimer;
function showLoader(title, steps = []) {
  $('#loader-title').textContent = title;
  $('#loader-sub').textContent = steps[0] || '';
  $('#loader').hidden = false;
  clearInterval(loaderTimer);
  let i = 0;
  if (steps.length > 1) {
    loaderTimer = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      $('#loader-sub').textContent = steps[i];
    }, 2600);
  }
}
function hideLoader() {
  clearInterval(loaderTimer);
  $('#loader').hidden = true;
}

/** Descarga un archivo generado por el servidor mostrando la carga mientras se genera. */
async function download(url, title, steps) {
  showLoader(title, steps);
  try {
    const res = await fetch(url);
    if (res.status === 401) return (location.href = '/login');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
    const blob = await res.blob();
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'archivo';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Descargado: ${name}`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    hideLoader();
  }
}
const PDF_STEPS = ['Completando la plantilla con el dashboard…', 'Imprimiendo el documento…'];

// ---------------- Vistas ----------------

function setView(view) {
  ui.view = view;
  local.set('s1-view', view);
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  for (const v of ['chat', 'dashboard', 'versions']) {
    $(`#view-${v}`).hidden = v !== view;
    const tab = $(`#tab-${v}`);
    tab.classList.toggle('on', v === view);
    tab.setAttribute('aria-selected', v === view);
  }
  if (view === 'chat') scrollChat();
}

// ---------------- Render general ----------------

function current() {
  const s = ui.snap;
  return s?.analysis ? computeDashboard(s.catalog, s.analysis, ui.overrides) : null;
}

function render() {
  const { snap } = ui;
  if (!snap) return;
  renderTopbar();
  $('#supported').textContent = snap.agent.supported.map((x) => x.slice(1).toUpperCase()).join(' · ');
  $('#file-input').accept = snap.agent.supported.join(',');
  $('#composer-hint').textContent = `Evaluación contra ${snap.catalog.shortName} (${snap.catalog.safeguards.length} salvaguardas). Puedes arrastrar archivos al chat.`;
  $('#welcome-text').textContent = `Sube la documentación de ${snap.workspace.name === 'Mi primera evaluación' ? 'la organización' : snap.workspace.name} o descríbela aquí mismo. Evalúo las ${snap.catalog.safeguards.length} salvaguardas de ${snap.catalog.shortName} con citas verificadas y armo el dashboard.`;
  renderDocs();

  const d = current();
  $('#health-badge').hidden = !d;
  if (d) {
    $('#hb-value').textContent = pct(d.implementation);
    $('#hb-cov').textContent = pct(d.coverage);
  }
  $('#empty').hidden = !!d;
  $('#dashboard').hidden = !d;
  if (d) renderDashboard(d);
  renderSuggestions();
  renderChatEval();
  renderVersions(d);
}

function renderTopbar() {
  const { snap } = ui;
  $('#ws-name').textContent = snap.workspace.name;
  $('#ws-ig').textContent = `IG${snap.workspace.ig}`;
  $('#ws-list').innerHTML = snap.workspaces
    .map(
      (w) => `<button type="button" role="menuitem" class="ws-item${w.id === snap.workspace.id ? ' on' : ''}" data-ws="${w.id}">
        <span class="ws-item-name">${esc(w.name)}</span>
        <span class="ws-item-meta"><span class="ig-pill">IG${w.ig}</span>${w.implementation != null ? `${esc(pct(w.implementation))}` : w.documents ? `${w.documents} doc.` : 'vacía'}</span>
      </button>`
    )
    .join('');
  $('#ws-delete').hidden = snap.workspaces.length < 2;
  $('#user-initial').textContent = (snap.user.name || '?').trim().charAt(0).toUpperCase();
  $('#user-email').textContent = `${snap.user.name} · ${snap.user.email}`;

  const { ai, error: err } = snap.agent;
  $('#engine-dot').className = 'status-dot ' + (ai.connected && !err ? 'ok' : 'warn');
  $('#ai-label').textContent = ai.connected ? `${ai.model}${ai.source === 'servidor' ? ' · servidor' : ''}` : 'Motor demo · conecta tu IA';
  $('#ai-pill').title = !ai.connected ? 'Sin IA conectada: SalamiOne usa el motor demo de reglas. Haz clic para conectar tu modelo.' : err ? `IA no disponible: ${err.message}` : `Conectado: ${ai.label}`;
  if (err && err.at !== ui.lastErrorAt) {
    ui.lastErrorAt = err.at;
    toast(err.message, true);
  }
}

function renderDocs() {
  const { documents, analysis, stale } = ui.snap;
  $('#tray').hidden = !documents.length;
  $('#stale').hidden = !stale;
  const since = analysis?.generatedAt;
  $('#doc-list').innerHTML = documents
    .map(
      (d) => `<span class="doc-chip${d.role === 'evidencia' ? ' ev' : ''}${since && d.role !== 'evidencia' && d.uploadedAt > since ? ' new' : ''}" title="${esc(d.preview)}">
        <span aria-hidden="true">${d.source === 'chat' ? '💬' : d.role === 'evidencia' ? '🆕' : '📄'}</span><span class="n">${esc(d.name)}</span>
        <span class="k">${d.role === 'evidencia' ? 'evidencia' : d.source === 'chat' ? 'chat' : 'contexto'}</span>
        <button type="button" data-del-doc="${d.id}" aria-label="Quitar ${esc(d.name)}">✕</button>
      </span>`
    )
    .join('');
  const btn = $('#btn-analyze');
  btn.textContent = analysis ? 'Rehacer evaluación' : 'Analizar documentación';
  btn.disabled = !documents.some((d) => d.role !== 'evidencia');
}

// ---------------- Dashboard ----------------

function renderDashboard(d) {
  const { catalog, analysis, proposal } = ui.snap;
  $('#catalog-title').textContent = `${catalog.shortName} · ${catalog.safeguards.length} salvaguardas`;
  $('#company-name').textContent = d.company.name === 'No informado' ? ui.snap.workspace.name : d.company.name;
  $('#company-sector').textContent = d.company.sector === 'No informado' ? '' : `Sector: ${d.company.sector}`;
  $('#summary').innerHTML = d.summary.map((p) => `<li>${esc(p)}</li>`).join('');
  const st = d.stats;
  $('#generated').textContent =
    `Evaluación: ${new Date(d.generatedAt).toLocaleString('es')}` +
    (d.updatedAt ? ` · actualizada: ${new Date(d.updatedAt).toLocaleString('es')}` : '') +
    ` · motor: ${d.engine}` +
    (st.quotes != null ? ` · ${st.quotes - st.rejectedQuotes} citas verificadas, ${st.rejectedQuotes} descartadas` : '');
  $('#analysis-warning').hidden = !analysis.warning;
  $('#analysis-warning').textContent = analysis.warning ? `⚠️ ${analysis.warning} Se usó el motor de respaldo.` : '';
  const igMismatch = (analysis.ig || 1) !== catalog.ig;
  if (igMismatch) {
    $('#analysis-warning').hidden = false;
    $('#analysis-warning').textContent = `⚠️ Esta evaluación se hizo con IG${analysis.ig || 1} y ahora el alcance es IG${catalog.ig}: las salvaguardas nuevas figuran como no verificadas hasta que rehagas la evaluación.`;
  }

  const initial = ui.snap.versions.find((v) => v.reason === 'analisis' && d.updatedAt)?.summary || null;
  $('#indicators').innerHTML = indicatorCards(d, initial);
  $('#kpis').innerHTML = kpiCards(d);
  renderProposal(proposal);
  $('#context').innerHTML = contextHtml(d.context);

  $('#controls-sub').textContent = `${catalog.controls.length} controles · ${catalog.safeguards.length} salvaguardas. Porcentaje = implementación sobre salvaguardas evaluables; "N/D" si no hay ninguna evaluable. Pie: implementadas·parciales·no impl.·no verificadas.`;
  $('#matrix-title').textContent = `Matriz de las ${catalog.safeguards.length} salvaguardas`;
  $('#map-legend').innerHTML = legend();
  const byId = Object.fromEntries(d.safeguards.map((s) => [s.id, s]));
  $('#ctrl-grid').innerHTML = d.controls.map((c) => controlCard(c, byId, { interactive: true })).join('');
  $('#scope-note').textContent = catalog.scope ? `Alcance: ${catalog.scope}` : '';

  $('#risks').innerHTML = risksTable(d);
  $('#roadmap').innerHTML = roadmapTable(d);
  renderSafeguards(d, byId);
}

function renderProposal(p) {
  const card = $('#proposal-card');
  card.hidden = !p;
  if (!p) return;
  const open = p.status === 'abierta';
  const counts = p.changes.reduce((a, c) => ((a[c.decision] = (a[c.decision] || 0) + 1), a), {});
  $('#proposal-sub').textContent =
    `${open ? 'Propuesta pendiente de validación' : `Aplicada el ${new Date(p.appliedAt).toLocaleString('es')}`} · ${p.documents.join(', ')} · ` +
    `${p.changes.length} salvaguardas afectadas: ${counts.aprobado || 0} aprobadas, ${counts.pendiente || 0} pendientes, ${counts.rechazado || 0} rechazadas, ${counts.sin_cambio || 0} sin cambio por evidencia insuficiente.`;
  $('#btn-apply-proposal').hidden = !open;
  $('#btn-apply-proposal').disabled = !counts.aprobado;
  $('#btn-discard-proposal').textContent = open ? 'Descartar' : 'Ocultar';
  $('#reported').innerHTML = p.initiatives.length ? `<h3 class="sub-h">Iniciativas reportadas</h3>${reportedInitiatives(p.initiatives)}` : '';
  $('#changes').innerHTML = `<h3 class="sub-h">Cambios propuestos (validación del auditor)</h3>${changesTable(p.changes, { interactive: open })}`;
}

function renderSafeguards(d, byId) {
  const keep = (s) =>
    ui.sfilter === 'all' ||
    (ui.sfilter === 'gaps' && (s.status === 'no_implementado' || s.status === 'parcial')) ||
    (ui.sfilter === 'applied' && s.overridden) ||
    (ui.sfilter === 'updated' && s.history.length) ||
    ui.sfilter === s.status;
  const html = d.controls
    .map((c) => {
      const items = c.safeguards.map((id) => byId[id]).filter(keep);
      if (!items.length) return '';
      const open = ui.open.has(c.id) || ui.sfilter !== 'all';
      return `<details class="sg-group" id="grp-${c.id}" data-group="${c.id}" ${open ? 'open' : ''}>
        <summary>
          <span class="g-title">${esc(c.id)}. ${esc(c.name)}</span>
          <span class="g-meta"><span>${c.safeguards.length} salvaguarda${c.safeguards.length > 1 ? 's' : ''} · cobertura ${esc(pct(c.coverage))}</span><span class="chip ${c.label.key}">${esc(c.implementation == null ? 'N/D' : `${fmt(c.implementation)}%`)}</span></span>
        </summary>
        ${items.map(sgHtml).join('')}
      </details>`;
    })
    .join('');
  $('#safeguards').innerHTML = html || '<p class="muted small">No hay salvaguardas en esta vista.</p>';
}

function sgHtml(s) {
  const gain = s.gain > 0 ? `<span class="delta-up">+${fmt(s.gain)} pts</span><small>de implementación si se implementa</small>` : '';
  const hist = s.history
    .map((h) => `<div class="sg-hist">↻ ${new Date(h.at).toLocaleDateString('es')}: ${esc(STATUS[h.from]?.long || h.from)} → ${esc(STATUS[h.to]?.long || h.to)} (${esc(h.documents.join(', '))})</div>`)
    .join('');
  return `<div class="sg" id="sg-${s.id.replace('.', '-')}">
    <div>
      <div class="sg-title"><span class="sid">${esc(s.id)}</span>${esc(s.title)}<span class="ig-pill soft">IG${s.ig || 1}</span></div>
      <div class="sg-desc">${esc(s.description)}</div>
      <div class="sg-doc">Aplicabilidad: <strong>${esc(APPLICABILITY[s.applicability])}</strong> · Según evidencia: ${statusChip(s.documented, true)}${
        s.downgraded ? ' <span title="La cita del agente no se encontró en el documento.">(cita no verificada)</span>' : ''
      }</div>
      ${s.rationale ? `<div class="sg-why"><strong>Justificación:</strong> ${esc(s.rationale)}</div>` : ''}
      ${s.observations ? `<div class="sg-why"><strong>Observaciones:</strong> ${esc(s.observations)}</div>` : ''}
      ${evidenceHtml(s)}
      ${hist}
    </div>
    <div class="sg-side">
      <div class="seg" role="radiogroup" aria-label="Simular estado de ${esc(s.id)}">
        ${APPLICABLE.map((k) => `<button data-sg="${s.id}" data-status="${k}" role="radio" aria-checked="${s.status === k}" class="${s.status === k ? 'on' : ''}">${STATUS[k].label}</button>`).join('')}
      </div>
      ${s.overridden ? `<button class="reset-link" data-sg="${s.id}" data-status="documentado">Volver a la evidencia</button>` : ''}
      <div class="gain">${gain}</div>
      <button class="ask-btn" data-ask="${s.id}">Preguntar en el chat</button>
    </div>
  </div>`;
}

function openGroup(controlId) {
  setView('dashboard');
  ui.open.add(controlId);
  if (ui.sfilter !== 'all') {
    ui.sfilter = 'all';
    document.querySelectorAll('[data-sfilter]').forEach((b) => b.classList.toggle('on', b.dataset.sfilter === 'all'));
  }
  render();
}

function flash(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function gotoSafeguard(id) {
  const s = ui.snap.catalog.safeguards.find((x) => x.id === id);
  if (!s) return;
  openGroup(s.controlId);
  flash(document.getElementById(`sg-${id.replace('.', '-')}`));
}

// ---------------- Versiones y comparación ----------------

const reasonLabel = { analisis: 'Evaluación inicial', actualizacion: 'Actualizada', manual: 'Guardada' };
const fdate = (iso) => new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const deltaSpan = (n, suffix = '') =>
  n == null ? '<span class="delta-flat">—</span>' : n > 0 ? `<span class="delta-up">${signed(n)}${suffix}</span>` : n < 0 ? `<span class="delta-down">${signed(n)}${suffix}</span>` : `<span class="delta-flat">0${suffix}</span>`;

function summaryOf(key, d) {
  if (key === 'current') return d ? { label: 'Estado actual (sin guardar)', summary: versionSummary(d) } : null;
  const v = ui.snap.versions.find((x) => x.id === key);
  return v ? { label: `v${v.n} · ${v.label}`, summary: v.summary } : null;
}

function ensureSelection(d) {
  const vs = ui.snap.versions;
  const valid = (k) => (k === 'current' ? !!d : vs.some((v) => v.id === k));
  if (!valid(ui.cmpB)) ui.cmpB = vs.length > 1 ? vs.at(-1).id : d ? 'current' : vs.at(-1)?.id || null;
  if (!valid(ui.cmpA) || ui.cmpA === ui.cmpB) {
    const init = [...vs].reverse().find((v) => v.reason === 'analisis') || vs[0];
    ui.cmpA = init && init.id !== ui.cmpB ? init.id : vs.find((v) => v.id !== ui.cmpB)?.id || null;
  }
}

function renderVersions(d) {
  const vs = ui.snap.versions;
  $('#ver-count').hidden = !vs.length;
  $('#ver-count').textContent = vs.length;
  $('#v-empty').hidden = vs.length > 0;
  $('#versions').hidden = !vs.length;
  if (!vs.length) return;
  ensureSelection(d);

  $('#ver-items').innerHTML = [...vs]
    .reverse()
    .map((v) => {
      const prev = vs[vs.indexOf(v) - 1];
      const dl = prev && v.summary.implementation != null && prev.summary.implementation != null ? Math.round((v.summary.implementation - prev.summary.implementation) * 10) / 10 : null;
      const cls = [ui.cmpA === v.id && 'sel-a', ui.cmpB === v.id && 'sel-b'].filter(Boolean).join(' ');
      return `<li class="ver-item ${cls}">
        <div class="ver-top"><span class="ver-n">v${v.n}</span><span class="ver-label" title="${esc(v.label)}">${esc(v.label)}</span>
          <span class="ver-idx">${esc(pct(v.summary.implementation))}</span></div>
        <div class="ver-meta"><span class="ver-reason">${esc(reasonLabel[v.reason] || v.reason)}</span><span>${esc(fdate(v.createdAt))}</span>
          ${dl != null ? `<span>${deltaSpan(dl, ' pts')}</span>` : ''}<span>· cobertura ${esc(pct(v.summary.coverage))}</span></div>
        <div class="ver-actions">
          <button data-cmp-a="${v.id}" class="${ui.cmpA === v.id ? 'on-a' : ''}" title="Usar como antes (A)">A</button>
          <button data-cmp-b="${v.id}" class="${ui.cmpB === v.id ? 'on-b' : ''}" title="Usar como después (B)">B</button>
          <a class="ver-dl" data-dl href="/api/export/dashboard.xlsx?version=${v.id}" title="Descargar esta versión en Excel">Excel</a>
          <a class="ver-dl" data-dl href="/api/export/dashboard.pdf?version=${v.id}" title="Descargar esta versión en PDF">PDF</a>
          <button data-restore="${v.id}" title="Volver a esta versión">Restaurar</button>
          <button data-del-version="${v.id}" class="del" title="Eliminar versión" aria-label="Eliminar v${v.n}">✕</button>
        </div>
      </li>`;
    })
    .join('');

  const opts = (sel) =>
    (d ? `<option value="current"${sel === 'current' ? ' selected' : ''}>Estado actual (sin guardar) · ${esc(pct(d.implementation))}</option>` : '') +
    [...vs].reverse().map((v) => `<option value="${v.id}"${sel === v.id ? ' selected' : ''}>v${v.n} · ${esc(v.label)} · ${esc(pct(v.summary.implementation))}</option>`).join('');
  $('#cmp-a').innerHTML = opts(ui.cmpA);
  $('#cmp-b').innerHTML = opts(ui.cmpB);
  const q = `a=${encodeURIComponent(ui.cmpA || 'inicial')}&b=${encodeURIComponent(ui.cmpB || 'current')}`;
  $('#cmp-pdf').href = `/api/export/compare.pdf?${q}`;
  $('#cmp-xlsx').href = `/api/export/compare.xlsx?${q}`;
  renderComparison(d);
}

function renderComparison(d) {
  const A = summaryOf(ui.cmpA, d);
  const B = summaryOf(ui.cmpB, d);
  if (!A || !B) {
    $('#cmp-body').innerHTML = '<p class="muted small">Hace falta al menos otra versión para comparar.</p>';
    return;
  }
  const c = compareVersions(A.summary, B.summary);
  const verdict = `<div class="verdict ${c.verdict.key}" role="status"><span class="verdict-k">${esc(c.verdict.label)}</span><p>${esc(c.verdict.text)}</p></div>`;
  const side = (tag, X, imp, cov) => `<div class="cmp-side"><p class="eyebrow"><span class="cmp-tag ${tag}">${tag.toUpperCase()}</span>${esc(X.label)}</p>
      <div class="big">${esc(pct(imp))}</div><div class="small muted">Implementación · Cobertura ${esc(pct(cov))}</div></div>`;
  const hero = `<div class="cmp-hero">
    ${side('a', A, c.implementation.a, c.coverage.a)}
    <div class="cmp-arrow" aria-hidden="true">→</div>
    ${side('b', B, c.implementation.b, c.coverage.b)}
    <div class="cmp-delta"><div class="d">${deltaSpan(c.implementation.delta, ' pts')}</div>
      <div class="small muted">Cobertura ${deltaSpan(c.coverage.delta, ' pts')} · ${c.improved} mejora${c.improved === 1 ? '' : 's'} · ${c.worsened} retroceso${c.worsened === 1 ? '' : 's'}</div></div>
  </div>`;

  const counts = `<div class="cmp-counts cmp-5">${Object.entries(STATUS)
    .map(([k, v]) => {
      const x = c.counts[k] || { a: 0, b: 0, delta: 0 };
      const good = k === 'implementado' ? x.delta > 0 : k === 'no_implementado' ? x.delta < 0 : null;
      const ds = x.delta ? `<small class="${good == null ? 'delta-flat' : good ? 'delta-up' : 'delta-down'}">${x.delta > 0 ? '+' : ''}${x.delta}</small>` : '';
      return `<div class="cmp-count"><div class="lbl"><span class="sq ${k}"></span>${esc(v.label)}</div><div class="v">${x.a} → ${x.b}${ds}</div></div>`;
    })
    .join('')}</div>`;

  const rows = c.controls.filter((x) => ui.cmpAllControls || (x.delta !== 0 && !(x.a == null && x.b == null)));
  const maxAbs = Math.max(1, ...c.controls.map((x) => Math.abs(x.delta || 0)));
  const controls = `<div class="cmp-section">
    <h3>Implementación por control <button class="link-btn" id="cmp-toggle-all">${ui.cmpAllControls ? 'Solo los que cambiaron' : `Ver los ${c.controls.length} controles`}</button></h3>
    ${rows.length
      ? `<div class="table-wrap"><table class="cmp-table"><thead><tr><th>Control</th><th class="num">A</th><th class="hide-sm">Variación</th><th class="num">B</th><th class="num">Δ</th></tr></thead><tbody>${rows
          .map((x) => {
            const w = x.delta ? (Math.abs(x.delta) / maxAbs) * 50 : 0;
            return `<tr><td><span class="id">${esc(x.id)}.</span> ${esc(x.name)}</td><td class="num">${esc(x.a == null ? 'N/D' : `${fmt(x.a)}%`)}</td>
              <td class="hide-sm"><div class="dbar" aria-hidden="true">${x.delta ? `<i class="${x.delta > 0 ? 'up' : 'down'}" style="width:${w}%"></i>` : ''}</div></td>
              <td class="num">${esc(x.b == null ? 'N/D' : `${fmt(x.b)}%`)}</td><td class="num">${deltaSpan(x.delta)}</td></tr>`;
          })
          .join('')}</tbody></table></div>`
      : '<p class="muted small">Ningún control cambió entre A y B.</p>'}
  </div>`;

  const order = { retroceso: 0, mejora: 1, neutral: 2, nueva: 3, eliminada: 4 };
  const changes = [...c.changes].sort((x, y) => order[x.direction] - order[y.direction] || x.id.localeCompare(y.id, 'es', { numeric: true }));
  const sgs = `<div class="cmp-section">
    <h3>Salvaguardas que cambiaron <span class="muted small">${changes.length}</span></h3>
    ${changes.length
      ? `<div class="table-wrap"><table class="cmp-table"><thead><tr><th>ID</th><th>Salvaguarda</th><th>Estado A → B</th><th class="num">Resultado</th></tr></thead><tbody>${changes
          .map(
            (x) => `<tr><td class="id"><button class="link-btn" data-goto="${esc(x.id)}">${esc(x.id)}</button></td>
              <td>${esc(x.title)}${x.applied ? '<span class="tag-applied">· simulado</span>' : ''}</td>
              <td><span class="arrow-st">${x.from ? statusChip(x.from) : '—'} → ${x.to ? statusChip(x.to) : '—'}</span></td>
              <td class="num"><span class="dir ${x.direction}">${esc(x.direction)}</span></td></tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="muted small">No hay diferencias entre A y B.</p>'}
  </div>`;

  const risks = c.risks.length
    ? `<div class="cmp-section"><h3>Riesgos: cuáles cambiaron y cuáles permanecen</h3>
      <div class="table-wrap"><table class="cmp-table"><thead><tr><th>ID</th><th>Riesgo</th><th>Severidad</th><th>Estado A → B</th><th class="num">Resultado</th></tr></thead><tbody>${c.risks
        .map(
          (r) => `<tr><td class="id">${esc(r.id)}</td><td>${esc(r.title)}</td><td>${severityChip(r.severity)}</td>
            <td><span class="arrow-st">${riskStateChip(r.from)} → ${r.to ? riskStateChip(r.to) : '—'}</span></td>
            <td class="num"><span class="dir ${r.changed ? 'mejora' : 'neutral'}">${r.changed ? 'cambió' : 'permanece'}</span></td></tr>`
        )
        .join('')}</tbody></table></div></div>`
    : '';

  $('#cmp-body').innerHTML = verdict + hero + counts + controls + sgs + risks;
}

async function saveVersion(label) {
  try {
    setSnap(await api('POST', '/api/versions', { label }));
    const v = ui.snap.versions.at(-1);
    ui.cmpB = v.id;
    render();
    toast(`Versión v${v.n} guardada.`);
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------- Chat ----------------

const inline = (s) =>
  s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(«"])\*(?!\s)([^*]+?)\*(?=[\s.,;:)»"]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s.,)]|$)/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

function md(text) {
  const lines = esc(text).split('\n');
  let html = '';
  let inList = false;
  let table = null;
  const closeList = () => inList && ((html += '</ul>'), (inList = false));
  const closeTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    html += `<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
      .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`;
    table = null;
  };
  for (const raw of lines) {
    const t = raw.trim();
    if (/^\|.*\|$/.test(t)) {
      closeList();
      if (/^\|[\s:|-]+\|$/.test(t)) continue;
      (table ||= []).push(t.slice(1, -1).split('|').map((c) => c.trim()));
      continue;
    }
    closeTable();
    const line = inline(raw);
    const li = line.match(/^\s*(?:[-•]|\*(?=\s)|\d+[.)])\s+(.*)/);
    if (li) {
      if (!inList) (html += '<ul>'), (inList = true);
      html += `<li>${li[1]}</li>`;
      continue;
    }
    closeList();
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) html += `<p class="md-h">${h[1]}</p>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  closeTable();
  closeList();
  return html;
}

function actionHtml(a) {
  const delta = a.before !== undefined && a.after != null ? ` · implementación ${esc(pct(a.before))} → <strong>${esc(pct(a.after))}</strong>` : '';
  const isFile = !!a.href;
  const kind = /xlsx/.test(a.href || '') ? 'Excel' : 'PDF';
  const btn = isFile
    ? `<a class="go dl" data-dl href="${esc(a.href)}">Descargar ${kind} ↓</a>${a.extra ? `<a class="go dl" data-dl href="${esc(a.extra.href)}">${esc(a.extra.label)} ↓</a>` : ''}`
    : `<button class="go" data-view="dashboard">Ver dashboard →</button>`;
  return `<div class="action"><span aria-hidden="true">${isFile ? '📄' : '⚡'}</span><span>${esc(a.text)}${delta}</span>${btn}</div>`;
}

function msgHtml(m) {
  if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.content)}</div></div>`;
  if (m.role === 'system') return `<div class="msg system"><div class="bubble">${esc(m.content)}</div></div>`;
  const actions = m.actions?.length ? `<div class="actions">${m.actions.map(actionHtml).join('')}</div>` : '';
  return `<div class="msg assistant"><img class="avatar" src="logo.svg" alt="SalamiOne" /><div class="bubble">${md(m.content)}${actions}</div></div>`;
}

function scrollChat() {
  const s = $('#chat-scroll');
  requestAnimationFrame(() => (s.scrollTop = s.scrollHeight));
}

function renderChat() {
  $('#welcome').hidden = ui.chat.length > 0;
  $('#chat-log').innerHTML =
    ui.chat.map(msgHtml).join('') +
    (ui.busy ? `<div class="msg assistant"><img class="avatar" src="logo.svg" alt="" /><div class="typing-dots" aria-label="SalamiOne está escribiendo"><i></i><i></i><i></i></div></div>` : '');
  if (ui.wsId) local.set(`s1-chat-${ui.wsId}`, ui.chat.slice(-60));
  scrollChat();
  renderChatEval();
}

function pushMsg(m) {
  ui.chat.push(m);
  renderChat();
}

const DESCRIBE_TEMPLATE = `Somos [organización], del sector [sector], con [N] empleados y [sedes].
Infraestructura: [servidores propios / cloud / híbrido], [N] equipos de usuario.
Cuentas y accesos: [¿cuentas nominales? ¿MFA en correo, VPN y administradores?].
Respaldos: [frecuencia, copia fuera de sitio, pruebas de restauración].
Parches y antimalware: [cómo se actualiza, qué antivirus/EDR].
Registros y monitoreo: [logs, SIEM, revisiones].
Capacitación: [concienciación, phishing].
Incidentes y proveedores: [responsable, procedimiento, contratos].`;

function renderSuggestions() {
  const s = ui.snap;
  let items;
  if (!s.documents.length && !s.analysis) {
    items = [
      { label: 'Cargar el caso de ejemplo', action: 'sample' },
      { label: 'Subir un documento de contexto', action: 'attach' },
      { label: 'Describir mi organización en el chat', action: 'describe' },
      { label: '¿Qué diferencia hay entre IG1, IG2 e IG3?' },
    ];
  } else if (!s.analysis) {
    items = [{ label: 'Analizar la documentación', action: 'analyze' }, { label: `¿Qué salvaguardas de ${s.catalog.shortName} vas a evaluar y con qué criterios?` }];
  } else {
    items = [
      { label: '¿Cuál es la postura actual de ciberseguridad?' },
      { label: '¿Cuáles son los cinco riesgos principales?' },
      { label: 'Genera el resumen ejecutivo de una página' },
      { label: 'Subir nueva evidencia para comparar', action: 'evidence' },
    ];
  }
  $('#suggestions').innerHTML = items
    .map((i) => `<button class="suggestion" ${i.action ? `data-sugg-action="${i.action}"` : ''} data-sugg="${esc(i.label)}">${esc(i.label)}</button>`)
    .join('');
}

/** Ofrece convertir la descripción escrita en el chat en un dashboard (si todavía no hay evaluación). */
function renderChatEval() {
  if (!ui.snap) return;
  const written = ui.chat.filter((m) => m.role === 'user').reduce((n, m) => n + m.content.length, 0);
  $('#chat-eval').hidden = !!ui.snap.analysis || ui.busy || written < 160;
}

async function sendChat(text) {
  if (ui.busy) return;
  pushMsg({ role: 'user', content: text });
  ui.busy = true;
  $('#chat-send').disabled = true;
  renderChat();
  try {
    const history = ui.chat.filter((m) => m.role !== 'system').map(({ role, content }) => ({ role, content }));
    const res = await api('POST', '/api/chat', { messages: history });
    ui.busy = false;
    pushMsg({ role: 'assistant', content: res.reply, actions: res.actions });
    if (res.state) setSnap(res.state);
  } catch (e) {
    ui.busy = false;
    pushMsg({ role: 'assistant', content: `No pude completar la respuesta: ${e.message}` });
  } finally {
    $('#chat-send').disabled = false;
  }
}

async function evaluateFromChat() {
  const messages = ui.chat.filter((m) => m.role !== 'system').map(({ role, content }) => ({ role, content }));
  showLoader('Armando el dashboard con tu descripción', ANALYSIS_STEPS());
  try {
    setSnap(await api('POST', '/api/evaluate-chat', { messages, title: 'Descripción en el chat' }));
    announceAnalysis('tu descripción en el chat');
  } catch (e) {
    toast(e.message, true);
  } finally {
    hideLoader();
  }
}

// ---------------- Documentos, análisis y nueva evidencia ----------------

const ANALYSIS_STEPS = () => {
  const c = ui.snap.catalog;
  return [
    'Interpretando el contexto de la organización…',
    `Evaluando ${c.safeguards.length} salvaguardas de ${c.shortName}…`,
    'Verificando cada cita contra el texto original…',
    'Identificando riesgos y armando el roadmap…',
    'Calculando implementación y cobertura…',
  ];
};
const EVIDENCE_STEPS = ['Leyendo la nueva evidencia…', 'Comparando contra la matriz actual (sin rehacer el diagnóstico)…', 'Verificando las citas…', 'Armando la propuesta de cambios para validar…'];

function announceAnalysis(source) {
  const d = current();
  if (!d) return;
  const n = d.counts;
  pushMsg({
    role: 'assistant',
    content:
      `Evaluación lista para **${d.company.name === 'No informado' ? ui.snap.workspace.name : d.company.name}** a partir de ${source}. Primero armé la ficha de contexto y después evalué las ${d.total} salvaguardas de ${d.shortName}.\n\n` +
      `- **Implementación:** ${pct(d.implementation)} sobre ${d.evaluable} salvaguardas evaluables\n` +
      `- **Cobertura de evaluación:** ${pct(d.coverage)}\n` +
      `- ${n.implementado} implementadas · ${n.parcial} parciales · ${n.no_implementado} no implementadas · ${n.no_verificado} no verificadas · ${n.no_aplicable} no aplicables\n\n` +
      `Identifiqué ${d.risks.length} riesgos principales y propuse ${d.initiatives.length} iniciativas. Las ${n.no_verificado} no verificadas no cuentan como incumplimiento.`,
    actions: [{ text: 'Evaluación guardada como versión' }],
  });
}

function afterProposal(p) {
  if (!p) return;
  const pend = p.changes.filter((c) => c.decision === 'pendiente').length;
  pushMsg({
    role: 'assistant',
    content:
      `Procesé **${p.documents.join(', ')}** sin rehacer el diagnóstico. Encontré ${p.initiatives.length} iniciativa(s) reportada(s) y **${pend} cambio(s) de estado propuestos** que necesitan tu validación.\n\n` +
      `Revísalos en **Actualización con nueva evidencia** del dashboard: aprueba, rechaza o deja pendiente cada uno y aplica los aprobados. Después compara el antes y el después en **Comparar**.`,
    actions: [{ text: 'Propuesta lista para validar' }],
  });
  setView('dashboard');
  flash($('#proposal-card'));
}

async function uploadFiles(files, role = 'contexto') {
  if (!files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  if (role === 'evidencia') {
    showLoader('Procesando la nueva evidencia', EVIDENCE_STEPS);
    try {
      const res = await api('POST', '/api/evidence', fd);
      setSnap(res);
      if (res.errors?.length) toast(res.errors.join(' · '), true);
      afterProposal(res.proposal);
    } catch (e) {
      toast(e.message, true);
    } finally {
      hideLoader();
    }
    return;
  }
  showLoader('Subiendo documentación…', [`Leyendo ${files.length} archivo${files.length > 1 ? 's' : ''}…`]);
  let added = [];
  try {
    const res = await api('POST', '/api/documents', fd);
    setSnap(res);
    added = res.added || [];
    if (res.errors?.length) toast(res.errors.join(' · '), true);
  } catch (e) {
    hideLoader();
    toast(e.message, true);
    return;
  }
  if (!added.length) return hideLoader();
  pushMsg({ role: 'system', content: `📄 ${added.join(', ')} ${added.length > 1 ? 'agregados' : 'agregado'} como documento de contexto.` });
  hideLoader();
  await runAnalysis(true);
}

async function loadSample(role = 'contexto') {
  if (role === 'evidencia' && !ui.snap.analysis) return toast('Primero hace falta la evaluación inicial.', true);
  showLoader(role === 'evidencia' ? 'Procesando la evidencia de ejemplo' : 'Cargando el caso de ejemplo', role === 'evidencia' ? EVIDENCE_STEPS : ['Leyendo el PDF de Distribuidora Andina S.A.…']);
  try {
    const res = await api('POST', `/api/sample/${role}`);
    setSnap(res);
    hideLoader();
    if (role === 'evidencia') return afterProposal(res.proposal);
    pushMsg({ role: 'system', content: `📄 Caso de ejemplo cargado: ${res.added.join(', ')}.` });
    await runAnalysis(true);
  } catch (e) {
    hideLoader();
    toast(e.message, true);
  }
}

async function runAnalysis(skipConfirm = false) {
  if (!ui.snap.documents.some((d) => d.role !== 'evidencia')) return;
  if (ui.snap.analysis && !skipConfirm && !(await askConfirm('¿Rehacer la evaluación?', 'Reemplaza el diagnóstico actual. Las versiones anteriores se conservan para comparar.', 'Rehacer evaluación'))) return;
  setView('chat');
  showLoader('Analizando la documentación', ANALYSIS_STEPS());
  try {
    setSnap(await api('POST', '/api/analyze'));
    announceAnalysis('los documentos cargados');
  } catch (e) {
    toast(e.message, true);
  } finally {
    hideLoader();
  }
}

async function setSafeguard(id, status) {
  const prev = { ...ui.overrides };
  if (status === 'documentado') delete ui.overrides[id];
  else ui.overrides[id] = status;
  render();
  try {
    ui.snap = await api('PUT', `/api/safeguards/${encodeURIComponent(id)}`, { status });
  } catch (e) {
    ui.overrides = prev;
    render();
    toast(e.message, true);
  }
}

// ---------------- Evaluaciones (espacios de trabajo) ----------------

let wsMode = 'new';
function openWsDialog(mode) {
  wsMode = mode;
  const edit = mode === 'edit';
  $('#ws-dialog-title').textContent = edit ? 'Editar evaluación' : 'Nueva evaluación';
  $('#ws-submit').textContent = edit ? 'Guardar' : 'Crear evaluación';
  $('#ws-input-name').value = edit ? ui.snap.workspace.name : '';
  const ig = String(edit ? ui.snap.workspace.ig : 1);
  document.querySelectorAll('#ws-form input[name="ig"]').forEach((r) => (r.checked = r.value === ig));
  $('#ws-ig-note').hidden = !edit || !ui.snap.analysis;
  $('#ws-dialog').showModal();
}

$('#ws-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#ws-input-name').value.trim();
  const ig = Number(document.querySelector('#ws-form input[name="ig"]:checked').value);
  $('#ws-dialog').close();
  try {
    if (wsMode === 'edit') setSnap(await api('PUT', `/api/workspaces/${ui.snap.workspace.id}`, { name, ig }));
    else {
      setSnap(await api('POST', '/api/workspaces', { name, ig }));
      setView('chat');
      toast(`Evaluación creada: ${name} (IG${ig}).`);
    }
  } catch (err) {
    toast(err.message, true);
  }
});
$('#ws-cancel').addEventListener('click', () => $('#ws-dialog').close());

// ---------------- Configuración de IA ----------------

const aiState = { settings: null, provider: null };

function renderProviders() {
  const { providers, config, server } = aiState.settings;
  const cards = [
    ...Object.entries(providers).map(([k, p]) => ({ k, label: p.label, sub: p.needsKey ? 'Con tu API key' : 'Sin clave' })),
    ...(server ? [{ k: 'server', label: 'IA del servidor', sub: `${server.model}` }] : []),
    { k: 'none', label: 'Motor demo', sub: 'Reglas, sin IA' },
  ];
  $('#prov-grid').innerHTML = cards
    .map((c) => `<button type="button" role="radio" aria-checked="${aiState.provider === c.k}" class="prov${aiState.provider === c.k ? ' on' : ''}" data-prov="${c.k}"><b>${esc(c.label)}</b><small>${esc(c.sub)}</small></button>`)
    .join('');
  const p = providers[aiState.provider];
  $('#ai-fields').hidden = !p;
  if (!p) return;
  const same = config?.provider === aiState.provider;
  $('#f-key').hidden = !p.needsKey && aiState.provider !== 'compatible';
  $('#ai-key').placeholder = same && config.key ? `Guardada (${config.key}). Escribe una nueva para reemplazarla.` : p.hint;
  $('#key-hint').textContent = p.needsKey ? p.hint : 'Opcional: solo si tu servidor la exige.';
  $('#key-link').hidden = !p.keyUrl;
  if (p.keyUrl) $('#key-link').href = p.keyUrl;
  $('#f-url').hidden = !['ollama', 'compatible'].includes(aiState.provider);
  $('#ai-url').placeholder = p.baseURL || 'https://mi-servidor/v1';
  $('#ai-model').placeholder = p.defaultModel || 'nombre-del-modelo';
}

async function openAiDialog() {
  try {
    aiState.settings = await api('GET', '/api/me/ai');
  } catch (e) {
    return toast(e.message, true);
  }
  const { config, server } = aiState.settings;
  aiState.provider = config?.provider || (server ? 'server' : 'openai');
  $('#ai-key').value = '';
  $('#ai-url').value = config?.baseURL || '';
  $('#ai-model').value = config?.model || '';
  $('#ai-models').innerHTML = '';
  $('#ai-result').hidden = true;
  renderProviders();
  $('#ai-dialog').showModal();
}

const aiBody = () => ({ provider: aiState.provider, apiKey: $('#ai-key').value.trim() || undefined, baseURL: $('#ai-url').value.trim(), model: $('#ai-model').value.trim() });
const aiResult = (text, ok) => {
  const r = $('#ai-result');
  r.hidden = false;
  r.textContent = text;
  r.className = `ai-result small ${ok ? 'ok' : 'bad'}`;
};

$('#prov-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-prov]');
  if (!b) return;
  if (b.dataset.prov !== aiState.provider) {
    aiState.provider = b.dataset.prov;
    const cfg = aiState.settings.config;
    const same = cfg?.provider === aiState.provider;
    $('#ai-model').value = same ? cfg.model : '';
    $('#ai-url').value = same ? cfg.baseURL : '';
    $('#ai-key').value = '';
    $('#ai-models').innerHTML = '';
    $('#ai-result').hidden = true;
  }
  renderProviders();
});

$('#ai-load-models').addEventListener('click', async () => {
  aiResult('Consultando modelos disponibles…', true);
  try {
    const { models } = await api('POST', '/api/me/ai/models', aiBody());
    $('#ai-models').innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join('');
    aiResult(`${models.length} modelos disponibles. Elige uno en el campo Modelo.`, true);
    if (!$('#ai-model').value && models.length) $('#ai-model').value = models[0];
  } catch (e) {
    aiResult(e.message, false);
  }
});

$('#ai-test').addEventListener('click', async () => {
  if (!aiState.settings.providers[aiState.provider]) return aiResult('Elige un proveedor para probar.', false);
  aiResult('Probando la conexión…', true);
  try {
    const r = await api('POST', '/api/me/ai/test', aiBody());
    aiResult(`Conexión correcta con ${r.label} (${(r.ms / 1000).toFixed(1)} s). Salida estructurada verificada.`, true);
  } catch (e) {
    aiResult(e.message, false);
  }
});

$('#ai-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('PUT', '/api/me/ai', aiBody());
    setSnap(r.state);
    $('#ai-dialog').close();
    toast(r.state.agent.ai.connected ? `IA conectada: ${r.state.agent.ai.label}.` : 'Usando el motor demo (sin IA).');
  } catch (err) {
    aiResult(err.message, false);
  }
});
$('#ai-cancel').addEventListener('click', () => $('#ai-dialog').close());

// ---------------- Tutorial ----------------

function runTour() {
  setView('chat');
  startTour(
    [
      { title: 'Bienvenido a SalamiOne', text: 'Te muestro en un minuto cómo pasar de tus documentos a un dashboard CIS Controls v8.1, exportarlo y medir el antes y el después.' },
      { target: '[data-tour="workspace"]', title: 'Una evaluación por organización', text: 'Cada evaluación tiene su propio Implementation Group: IG1 (56 salvaguardas), IG2 (130) o IG3 (153). Crea, cambia o renombra evaluaciones desde aquí.' },
      { target: '[data-tour="ai"]', title: 'Conecta tu propio modelo', text: 'Usa tu API key de OpenAI, Claude o Gemini, o un modelo local con Ollama. Sin IA conectada, SalamiOne funciona con un motor demo de reglas.' },
      { target: '[data-tour="composer"]', title: 'Documentos o chat', text: 'Adjunta PDF, DOCX o TXT con 📎, o describe tu organización en un mensaje y pide el dashboard. Cada conclusión lleva una cita verificada del texto.' },
      { target: '[data-tour="tabs"]', title: 'Dashboard y comparación', text: 'El dashboard muestra implementación, cobertura, controles, riesgos y roadmap. En Comparar ves si los cambios mejoraron o empeoraron la postura.' },
      { target: '[data-tour="export"]', view: 'dashboard', title: 'Exporta en un clic', text: 'Descarga el dashboard en PDF o Excel, o un resumen ejecutivo de una página para la dirección.', needs: () => !!ui.snap.analysis },
      { title: 'Pruébalo con el caso de ejemplo', text: 'Carga Distribuidora Andina S.A. y mira la evaluación completa. Después sube su avance de iniciativas para comparar.', action: { label: 'Cargar el caso de ejemplo', run: () => loadSample('contexto') }, hideAction: () => !!ui.snap.analysis },
    ],
    { onView: setView, onDone: () => api('PUT', '/api/me', { onboarded: true }).catch(() => {}) }
  );
}

// ---------------- Tooltip ----------------

const tip = $('#tooltip');
function showTip(el, x, y) {
  tip.innerHTML = el.dataset.tip;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 14) + 'px';
  tip.style.top = Math.min(window.innerHeight - r.height - 8, y + 14) + 'px';
}
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el && el.dataset.tip) showTip(el, e.clientX, e.clientY);
  else tip.hidden = true;
});
document.addEventListener('focusin', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el && el.dataset.tip) {
    const r = el.getBoundingClientRect();
    showTip(el, r.right, r.top);
  }
});
document.addEventListener('focusout', () => (tip.hidden = true));

// ---------------- Menús desplegables ----------------

const menus = [
  ['#chat-attach', '#attach-menu'],
  ['#ws-btn', '#ws-menu'],
  ['#user-btn', '#user-menu'],
];
function closeMenus(except) {
  for (const [b, m] of menus) {
    if (m === except) continue;
    $(m).hidden = true;
    $(b).setAttribute('aria-expanded', 'false');
  }
}
for (const [b, m] of menus) {
  $(b).addEventListener('click', (e) => {
    e.stopPropagation();
    const open = $(m).hidden;
    closeMenus(m);
    $(m).hidden = !open;
    $(b).setAttribute('aria-expanded', open);
    if (open) $(m).querySelector('button')?.focus();
  });
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu, .attach-menu')) closeMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenus();
});

const pickFiles = (role) => {
  if (role === 'evidencia' && !ui.snap.analysis) return toast('Primero hace falta la evaluación inicial: adjunta el documento de contexto.', true);
  ui.uploadRole = role;
  $('#file-input').click();
};
$('#attach-menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-attach]');
  if (!b) return;
  closeMenus();
  const a = b.dataset.attach;
  if (a === 'context') pickFiles('contexto');
  else if (a === 'evidence') pickFiles('evidencia');
  else if (a === 'sample') loadSample(ui.snap.analysis ? 'evidencia' : 'contexto');
  else {
    $('#paste-role').value = ui.snap.analysis ? 'evidencia' : 'contexto';
    $('#paste-dialog').showModal();
  }
});

$('#ws-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ws]');
  if (!b) return;
  closeMenus();
  if (b.dataset.ws === ui.snap.workspace.id) return;
  try {
    setSnap(await api('POST', `/api/workspaces/${b.dataset.ws}/activate`));
    toast(`Evaluación: ${ui.snap.workspace.name}`);
  } catch (err) {
    toast(err.message, true);
  }
});
$('#ws-new').addEventListener('click', () => (closeMenus(), openWsDialog('new')));
$('#ws-edit').addEventListener('click', () => (closeMenus(), openWsDialog('edit')));
$('#ws-delete').addEventListener('click', async () => {
  closeMenus();
  const w = ui.snap.workspace;
  if (!(await askConfirm(`¿Eliminar "${w.name}"?`, 'Se borran sus documentos, el análisis, las versiones y los archivos exportados. No se puede deshacer.', 'Eliminar', true))) return;
  local.set(`s1-chat-${w.id}`, []);
  setSnap(await api('DELETE', `/api/workspaces/${w.id}`));
});

$('#ai-pill').addEventListener('click', openAiDialog);
$('#m-ai').addEventListener('click', () => (closeMenus(), openAiDialog()));
$('#m-tour').addEventListener('click', () => (closeMenus(), runTour()));
$('#m-logout').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout').catch(() => {});
  location.href = '/login';
});
$('#m-reset').addEventListener('click', async () => {
  closeMenus();
  if (!(await askConfirm('¿Vaciar esta evaluación?', 'Se borran los documentos, el análisis, las versiones y el chat de esta evaluación.', 'Vaciar', true))) return;
  ui.chat = [];
  ui.open.clear();
  setSnap(await api('POST', '/api/reset'));
  renderChat();
});

$('#file-input').addEventListener('change', (e) => {
  uploadFiles([...e.target.files], ui.uploadRole);
  e.target.value = '';
});

let dragDepth = 0;
const chatView = $('#view-chat');
chatView.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth++;
  $('#drop-hint').hidden = false;
});
chatView.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('#drop-hint').hidden = true;
  }
});
chatView.addEventListener('dragover', (e) => e.preventDefault());
chatView.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-hint').hidden = true;
  if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files], 'contexto');
});

$('#paste-cancel').addEventListener('click', () => $('#paste-dialog').close());
$('#paste-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#paste-name').value.trim() || 'Nota';
  const role = $('#paste-role').value;
  const text = $('#paste-text').value;
  $('#paste-dialog').close();
  showLoader(role === 'evidencia' ? 'Procesando la nueva evidencia' : 'Agregando el texto…', role === 'evidencia' ? EVIDENCE_STEPS : []);
  try {
    const res = await api('POST', '/api/documents/text', { name, text, role });
    setSnap(res);
    $('#paste-name').value = $('#paste-text').value = '';
    hideLoader();
    if (role === 'evidencia') afterProposal(res.proposal);
    else {
      pushMsg({ role: 'system', content: `📄 ${name} agregado como documento de contexto.` });
      await runAnalysis(true);
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    hideLoader();
  }
});

$('#btn-analyze').addEventListener('click', () => runAnalysis());
$('#btn-chat-eval').addEventListener('click', evaluateFromChat);
$('#btn-sample-empty').addEventListener('click', () => loadSample('contexto'));

$('#btn-1p').addEventListener('click', async () => {
  showLoader('Generando el resumen ejecutivo…', ['Completando la plantilla carta…', 'Ajustando el contenido a una página…', 'Verificando que el PDF tenga una sola página…']);
  try {
    const res = await api('POST', '/api/export/summary', {});
    setSnap(res);
    const a = Object.assign(document.createElement('a'), { href: res.report.url, download: res.report.file });
    document.body.append(a);
    a.click();
    a.remove();
    toast(`Generado: ${res.report.file}`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    hideLoader();
  }
});
$('#btn-save-version').addEventListener('click', () => saveVersion(`Versión guardada · ${new Date().toLocaleDateString('es')}`));
$('#ver-form').addEventListener('submit', (e) => {
  e.preventDefault();
  saveVersion($('#ver-name').value);
  $('#ver-name').value = '';
});
$('#cmp-a').addEventListener('change', (e) => {
  ui.cmpA = e.target.value;
  render();
});
$('#cmp-b').addEventListener('change', (e) => {
  ui.cmpB = e.target.value;
  render();
});
$('#cmp-swap').addEventListener('click', () => {
  [ui.cmpA, ui.cmpB] = [ui.cmpB, ui.cmpA];
  render();
});

$('#btn-apply-proposal').addEventListener('click', async () => {
  const p = ui.snap.proposal;
  const n = p.changes.filter((c) => c.decision === 'aprobado').length;
  if (!(await askConfirm(`¿Aplicar ${n} cambio(s) aprobado(s)?`, 'Los pendientes y rechazados no se aplican. La evaluación anterior se conserva como versión para comparar.', 'Aplicar'))) return;
  try {
    const res = await api('POST', '/api/proposal/apply');
    ui.cmpA = null;
    ui.cmpB = null;
    setSnap(res);
    pushMsg({
      role: 'assistant',
      content: `Apliqué ${n} cambio(s) aprobado(s) y guardé la **evaluación actualizada como v${res.applied.version}**. Abre **Comparar** para ver si la postura mejoró o empeoró.`,
      actions: [{ text: 'Diagnóstico actualizado', before: res.applied.before, after: res.applied.after }],
    });
    toast(`Evaluación actualizada guardada como v${res.applied.version}.`);
  } catch (e) {
    toast(e.message, true);
  }
});
$('#btn-discard-proposal').addEventListener('click', async () => {
  if (ui.snap.proposal?.status === 'abierta' && !(await askConfirm('¿Descartar la propuesta?', 'No se aplicará ningún cambio.', 'Descartar', true))) return;
  setSnap(await api('DELETE', '/api/proposal'));
});

$('#safeguards').addEventListener(
  'toggle',
  (e) => {
    const g = e.target.closest?.('[data-group]');
    if (!g || ui.sfilter !== 'all') return;
    g.open ? ui.open.add(g.dataset.group) : ui.open.delete(g.dataset.group);
  },
  true
);

document.addEventListener('click', async (e) => {
  // Descargas generadas por el servidor (PDF y Excel): con carga y aviso de errores.
  const dl = e.target.closest('a[data-dl], #btn-pdf, #btn-xlsx, #cmp-pdf, #cmp-xlsx');
  if (dl) {
    e.preventDefault();
    const pdf = /\.pdf/.test(dl.getAttribute('href'));
    return download(dl.getAttribute('href'), pdf ? 'Generando el PDF…' : 'Generando el Excel…', pdf ? PDF_STEPS : ['Armando las hojas…']);
  }
  const name = e.target.closest('.ctrl-name');
  if (name) {
    const id = name.closest('[data-ctrl]')?.dataset.ctrl;
    if (id) {
      openGroup(id);
      flash(document.getElementById(`grp-${id}`));
    }
    return;
  }
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if (ds.view) return setView(ds.view);
  if (ds.decide) {
    try {
      setSnap(await api('PUT', `/api/proposal/changes/${encodeURIComponent(ds.decide)}`, { decision: ds.decision }));
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  if (ds.cmpA) {
    ui.cmpA = ds.cmpA;
    if (ui.cmpB === ds.cmpA) ui.cmpB = 'current';
    return render();
  }
  if (ds.cmpB) {
    ui.cmpB = ds.cmpB;
    if (ui.cmpA === ds.cmpB) ui.cmpA = null;
    return render();
  }
  if (t.id === 'cmp-toggle-all') {
    ui.cmpAllControls = !ui.cmpAllControls;
    return render();
  }
  if (ds.restore) {
    const v = ui.snap.versions.find((x) => x.id === ds.restore);
    if (!(await askConfirm(`¿Restaurar v${v.n}?`, `El diagnóstico vuelve a "${v.label}". Los documentos no cambian.`, 'Restaurar'))) return;
    try {
      setSnap(await api('POST', `/api/versions/${ds.restore}/restore`));
      toast(`Restaurada v${v.n}.`);
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  if (ds.delVersion) {
    const v = ui.snap.versions.find((x) => x.id === ds.delVersion);
    if (!(await askConfirm(`¿Eliminar la versión v${v.n}?`, v.label, 'Eliminar', true))) return;
    return setSnap(await api('DELETE', `/api/versions/${ds.delVersion}`));
  }
  if (ds.delDoc) return setSnap(await api('DELETE', `/api/documents/${ds.delDoc}`));
  if (ds.sg) return setSafeguard(ds.sg, ds.status);
  if (ds.goto) return gotoSafeguard(ds.goto);
  if (ds.suggAction === 'attach') return pickFiles('contexto');
  if (ds.suggAction === 'evidence') return pickFiles('evidencia');
  if (ds.suggAction === 'analyze') return runAnalysis();
  if (ds.suggAction === 'sample') return loadSample('contexto');
  if (ds.suggAction === 'describe') {
    input.value = DESCRIBE_TEMPLATE;
    grow();
    input.focus();
    input.setSelectionRange(6, 20);
    return;
  }
  if (ds.sugg) return sendChat(ds.sugg);
  if (ds.ask) {
    const s = ui.snap.catalog.safeguards.find((x) => x.id === ds.ask);
    setView('chat');
    return sendChat(`Cuéntame sobre la salvaguarda ${ds.ask}${s ? ` (${s.title})` : ''}: qué evidencia hay, por qué tiene ese estado y qué faltaría.`);
  }
  if (ds.sfilter) {
    ui.sfilter = ds.sfilter;
    document.querySelectorAll('[data-sfilter]').forEach((b) => b.classList.toggle('on', b === t));
    return render();
  }
});

const input = $('#chat-input');
const grow = () => {
  input.style.height = 'auto';
  input.style.height = Math.min(220, input.scrollHeight) + 'px';
};
input.addEventListener('input', grow);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('#chat-form').requestSubmit();
  }
});
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = input.value.trim();
  if (!v || ui.busy) return;
  input.value = '';
  grow();
  sendChat(v);
});

// ---------------- Inicio ----------------

setView(ui.view);
api('GET', '/api/state')
  .then((snap) => {
    setSnap(snap);
    if (!snap.user.onboarded) runTour();
  })
  .catch((e) => toast(e.message, true));
