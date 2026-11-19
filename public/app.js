import { computeDashboard, fmt, STATUS, APPLICABLE } from './scoring.js';
import { esc, statusChip, legend, kpiCards, controlCard, evidenceHtml } from './components.js';
import { versionSummary, compareVersions } from './versions.js';

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
  snap: null, // último estado del servidor
  overrides: {}, // estados aplicados (optimista)
  view: ['#chat', '#dashboard', '#versions'].includes(location.hash) ? location.hash.slice(1) : local.get('cc-view', 'chat'),
  cmpA: null, // id de versión o 'current'
  cmpB: null,
  cmpAllControls: false,
  sfilter: 'all',
  open: new Set(), // controles desplegados en la lista de salvaguardas
  chat: local.get('cc-chat', []), // {role: user|assistant|system, content, actions?}
  busy: false,
  lastErrorAt: null,
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
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function setSnap(snap) {
  ui.snap = snap;
  ui.overrides = { ...snap.overrides };
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

// ---------------- Vistas ----------------

function setView(view) {
  ui.view = view;
  local.set('cc-view', view);
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

  renderModelPicker();
  $('#supported').textContent = snap.agent.supported.map((x) => x.slice(1).toUpperCase()).join(' · ');
  $('#file-input').accept = snap.agent.supported.join(',');
  $('#composer-hint').textContent = `Cyber Cactus evalúa contra ${snap.catalog.shortName} usando solo tu documentación. Podés arrastrar archivos al chat.`;

  renderDocs();

  const d = current();
  $('#health-badge').hidden = !d;
  if (d) {
    $('#hb-value').textContent = `${fmt(d.index)}/100`;
    $('#hb-chip').className = `chip ${d.label.key}`;
    $('#hb-chip').textContent = d.label.label;
  }
  $('#empty').hidden = !!d;
  $('#dashboard').hidden = !d;
  if (d) renderDashboard(d);
  renderSuggestions();
  renderVersions(d);
}

function renderModelPicker() {
  const { agent } = ui.snap;
  const sel = $('#model-select');
  const opts = agent.models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  if (sel.dataset.opts !== opts) {
    sel.innerHTML = opts;
    sel.dataset.opts = opts;
  }
  sel.value = agent.selectedModel;
  const dot = $('#engine-dot');
  const err = agent.error;
  dot.className = 'status-dot ' + (agent.llm && !err ? 'ok' : 'warn');
  $('.model-picker').title = !agent.llm
    ? 'Sin OPENAI_API_KEY: Cyber Cactus funciona en modo demo. El modelo elegido se usará cuando configures la key.'
    : err
      ? `ChatGPT no disponible: ${err.message}`
      : `Conectado a OpenAI · ${agent.selectedModel}`;
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
      (d) => `<span class="doc-chip${since && d.uploadedAt > since ? ' new' : ''}" title="${esc(d.preview)}">
        <span aria-hidden="true">📄</span><span class="n">${esc(d.name)}</span><span class="k">${(d.chars / 1000).toFixed(1)}k</span>
        <button type="button" data-del-doc="${d.id}" aria-label="Quitar ${esc(d.name)}">✕</button>
      </span>`
    )
    .join('');
  const btn = $('#btn-analyze');
  btn.textContent = analysis ? 'Volver a analizar' : 'Analizar documentación';
  btn.disabled = !documents.length;
}

// ---------------- Dashboard ----------------

function animateNumber(el, to) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 450);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderDashboard(d) {
  const cat = ui.snap.catalog;
  $('#catalog-title').textContent = cat.shortName;
  $('#company-name').textContent = d.company.name === 'No informado' ? 'Organización no informada en los documentos' : d.company.name;
  $('#company-sector').textContent = d.company.sector === 'No informado' ? '' : `Sector: ${d.company.sector}`;
  $('#summary').innerHTML = d.summary.map((p) => `<li>${esc(p)}</li>`).join('');
  const st = d.stats;
  $('#generated').textContent =
    `Análisis: ${new Date(d.generatedAt).toLocaleString('es')} · motor: ${d.engine}` +
    (st.quotes != null ? ` · ${st.quotes - st.rejectedQuotes} citas verificadas${st.rejectedQuotes ? `, ${st.rejectedQuotes} descartadas` : ''}` : '');
  const warn = ui.snap.analysis.warning;
  $('#analysis-warning').hidden = !warn;
  $('#analysis-warning').textContent = warn ? `⚠️ ${warn} Se usó el análisis de respaldo.` : '';

  animateNumber($('#health'), d.index);
  const hc = $('#health-chip');
  hc.className = `chip ${d.label.key}`;
  hc.textContent = d.label.label;
  const fill = $('#meter-fill');
  fill.style.width = d.index + '%';
  fill.style.background = `var(--s-${d.label.key})`;
  $('#meter-ghost').style.left = `calc(${d.baseIndex}% - 1px)`;
  const delta = Math.round((d.index - d.baseIndex) * 10) / 10;
  $('#health-delta').innerHTML = delta
    ? `Según documentación: <strong>${fmt(d.baseIndex)}</strong> · <span class="${delta > 0 ? 'delta-up' : 'delta-down'}">${delta > 0 ? '+' : ''}${fmt(delta)} pts por controles aplicados</span>`
    : `Estado según la documentación (sin controles aplicados).`;

  // Todo lo que sigue se genera a partir del catálogo: cantidad de controles, salvaguardas y estados.
  $('#kpis').innerHTML = kpiCards(d);
  $('#controls-sub').textContent = `${cat.controls.length} controles · ${cat.safeguards.length} salvaguardas. Cada celda es una salvaguarda: hacé clic para ver el detalle.`;
  $('#map-legend').innerHTML = legend();
  const byId = Object.fromEntries(d.safeguards.map((s) => [s.id, s]));
  $('#ctrl-grid').innerHTML = d.controls.map((c) => controlCard(c, byId, { interactive: true })).join('');
  $('#scope-note').textContent = cat.scope ? `Alcance: ${cat.scope}` : '';

  renderPriorities(d);
  renderSafeguards(d, byId);
}

function renderPriorities(d) {
  const top = d.priorities.slice(0, 8);
  $('#priorities').innerHTML = top.length
    ? top
        .map(
          (s) => `<div class="prio">
        <span class="pid">${esc(s.id)}</span>
        <div><div>${esc(s.title)}</div><div class="pctl">${esc(s.controlId)}. ${esc(s.controlName)}</div></div>
        ${statusChip(s.status)}
        <div class="gain"><span class="delta-up">+${fmt(s.gain)} pts</span><small><button class="go" data-goto="${s.id}">ver →</button></small></div>
      </div>`
        )
        .join('')
    : '<p class="muted small">No hay salvaguardas pendientes. Caso cerrado.</p>';
}

function renderSafeguards(d, byId) {
  const keep = (s) =>
    ui.sfilter === 'all' ||
    (ui.sfilter === 'gaps' && s.status !== 'implementado') ||
    (ui.sfilter === 'applied' && s.overridden) ||
    ui.sfilter === s.status;
  const html = d.controls
    .map((c) => {
      const items = c.safeguards.map((id) => byId[id]).filter(keep);
      if (!items.length) return '';
      const open = ui.open.has(c.id) || ui.sfilter !== 'all';
      return `<details class="sg-group" id="grp-${c.id}" data-group="${c.id}" ${open ? 'open' : ''}>
        <summary>
          <span class="g-title">${esc(c.id)}. ${esc(c.name)}</span>
          <span class="g-meta"><span>${c.safeguards.length} salvaguarda${c.safeguards.length > 1 ? 's' : ''} · peso ${fmt(c.weightPct)}%</span><span class="chip ${c.label.key}">${fmt(c.score)}/100</span></span>
        </summary>
        ${items.map(sgHtml).join('')}
      </details>`;
    })
    .join('');
  $('#safeguards').innerHTML = html || '<p class="muted small">No hay salvaguardas en esta vista.</p>';
}

function sgHtml(s) {
  const gain = s.status === 'implementado' ? '' : `<span class="delta-up">+${fmt(s.gain)} pts</span><small>si se implementa</small>`;
  return `<div class="sg" id="sg-${s.id.replace('.', '-')}">
    <div>
      <div class="sg-title"><span class="sid">${esc(s.id)}</span>${esc(s.title)}</div>
      <div class="sg-desc">${esc(s.description)}</div>
      <div class="sg-doc">Según documentación: ${statusChip(s.documented)}${s.downgraded ? ' <span title="El agente dio un estado pero sus citas no se pudieron verificar en los documentos.">(citas no verificadas)</span>' : ''}</div>
      ${s.rationale && s.documented !== 'sin_evidencia' ? `<div class="sg-why">${esc(s.rationale)}</div>` : ''}
      ${evidenceHtml(s)}
    </div>
    <div class="sg-side">
      <div class="seg" role="radiogroup" aria-label="Estado aplicado de ${esc(s.id)}">
        ${APPLICABLE.map(
          (k) => `<button data-sg="${s.id}" data-status="${k}" role="radio" aria-checked="${s.status === k}" class="${s.status === k ? 'on' : ''}">${STATUS[k].label}</button>`
        ).join('')}
      </div>
      ${s.overridden ? `<button class="reset-link" data-sg="${s.id}" data-status="documentado">Volver a lo documentado</button>` : ''}
      <div class="gain">${gain}</div>
      <button class="ask-btn" data-ask="${s.id}">Preguntarle a Cyber Cactus</button>
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

const reasonLabel = { analisis: 'Análisis', manual: 'Guardada' };
const fdate = (iso) => new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const deltaSpan = (n, suffix = '') =>
  n > 0 ? `<span class="delta-up">${signed(n)}${suffix}</span>` : n < 0 ? `<span class="delta-down">${signed(n)}${suffix}</span>` : `<span class="delta-flat">0${suffix}</span>`;

function summaryOf(key, d) {
  if (key === 'current') return d ? { label: 'Estado actual (sin guardar)', summary: versionSummary(d) } : null;
  const v = ui.snap.versions.find((x) => x.id === key);
  return v ? { label: `v${v.n} · ${v.label}`, summary: v.summary } : null;
}

/** A y B por defecto: última versión guardada (A) contra el estado actual (B). */
function ensureSelection(d) {
  const vs = ui.snap.versions;
  const valid = (k) => (k === 'current' ? !!d : vs.some((v) => v.id === k));
  if (!valid(ui.cmpB)) ui.cmpB = d ? 'current' : vs.at(-1)?.id || null;
  if (!valid(ui.cmpA) || ui.cmpA === ui.cmpB) {
    const last = vs.at(-1);
    ui.cmpA = last && last.id !== ui.cmpB ? last.id : vs.at(-2)?.id || last?.id || null;
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

  // Historial (más reciente primero), con la variación del índice respecto de la versión anterior.
  $('#ver-items').innerHTML = [...vs]
    .reverse()
    .map((v) => {
      const prev = vs[vs.indexOf(v) - 1];
      const dlt = prev ? Math.round((v.summary.index - prev.summary.index) * 10) / 10 : null;
      const cls = [ui.cmpA === v.id && 'sel-a', ui.cmpB === v.id && 'sel-b'].filter(Boolean).join(' ');
      const n = v.summary.appliedCount;
      return `<li class="ver-item ${cls}">
        <div class="ver-top"><span class="ver-n">v${v.n}</span><span class="ver-label" title="${esc(v.label)}">${esc(v.label)}</span>
          <span class="ver-idx">${fmt(v.summary.index)}</span></div>
        <div class="ver-meta"><span class="ver-reason">${esc(reasonLabel[v.reason] || v.reason)}</span><span>${esc(fdate(v.createdAt))}</span>
          ${dlt != null ? `<span>${deltaSpan(dlt, ' pts')}</span>` : ''}
          <span>· ${n} control${n === 1 ? '' : 'es'} aplicado${n === 1 ? '' : 's'}</span></div>
        <div class="ver-actions">
          <button data-cmp-a="${v.id}" class="${ui.cmpA === v.id ? 'on-a' : ''}" title="Usar como referencia (A)">A</button>
          <button data-cmp-b="${v.id}" class="${ui.cmpB === v.id ? 'on-b' : ''}" title="Usar como comparada (B)">B</button>
          <button data-restore="${v.id}" title="Volver a este diagnóstico y sus controles aplicados">Restaurar</button>
          <button data-del-version="${v.id}" class="del" title="Eliminar versión" aria-label="Eliminar v${v.n}">✕</button>
        </div>
      </li>`;
    })
    .join('');

  const opts = (sel) =>
    (d ? `<option value="current"${sel === 'current' ? ' selected' : ''}>Estado actual (sin guardar) · ${fmt(d.index)}</option>` : '') +
    [...vs]
      .reverse()
      .map((v) => `<option value="${v.id}"${sel === v.id ? ' selected' : ''}>v${v.n} · ${esc(v.label)} · ${fmt(v.summary.index)}</option>`)
      .join('');
  $('#cmp-a').innerHTML = opts(ui.cmpA);
  $('#cmp-b').innerHTML = opts(ui.cmpB);

  renderComparison(d);
}

function renderComparison(d) {
  const A = summaryOf(ui.cmpA, d);
  const B = summaryOf(ui.cmpB, d);
  if (!A || !B) {
    $('#cmp-body').innerHTML = '<p class="muted small">Guardá al menos una versión para comparar.</p>';
    return;
  }
  const c = compareVersions(A.summary, B.summary);

  const hero = `<div class="cmp-hero">
    <div class="cmp-side"><p class="eyebrow"><span class="cmp-tag a">A</span>${esc(A.label)}</p>
      <div class="big">${fmt(c.index.a)}<small>/100</small></div><span class="chip ${A.summary.label.key}">${esc(A.summary.label.label)}</span></div>
    <div class="cmp-arrow" aria-hidden="true">→</div>
    <div class="cmp-side"><p class="eyebrow"><span class="cmp-tag b">B</span>${esc(B.label)}</p>
      <div class="big">${fmt(c.index.b)}<small>/100</small></div><span class="chip ${B.summary.label.key}">${esc(B.summary.label.label)}</span></div>
    <div class="cmp-delta"><div class="d">${deltaSpan(c.index.delta)}</div>
      <div class="small muted">${c.improved} mejora${c.improved === 1 ? '' : 's'} · ${c.worsened} retroceso${c.worsened === 1 ? '' : 's'}</div></div>
  </div>`;

  const counts = `<div class="cmp-counts">${Object.entries(STATUS)
    .map(([k, v]) => {
      const x = c.counts[k] || { a: 0, b: 0, delta: 0 };
      // Para "implementado" subir es bueno; para los demás estados, bajar es bueno.
      const good = k === 'implementado' ? x.delta > 0 : x.delta < 0;
      const ds = x.delta ? `<small class="${good ? 'delta-up' : 'delta-down'}">${x.delta > 0 ? '+' : ''}${x.delta}</small>` : '';
      return `<div class="cmp-count"><div class="lbl"><span class="sq ${k}"></span>${esc(v.label)}</div><div class="v">${x.a} → ${x.b}${ds}</div></div>`;
    })
    .join('')}</div>`;

  const ctrlRows = c.controls.filter((x) => ui.cmpAllControls || x.delta !== 0);
  const maxAbs = Math.max(1, ...c.controls.map((x) => Math.abs(x.delta || 0)));
  const controls = `<div class="cmp-section">
    <h3>Cumplimiento por control <button class="link-btn" id="cmp-toggle-all">${ui.cmpAllControls ? 'Solo los que cambiaron' : `Ver los ${c.controls.length} controles`}</button></h3>
    ${
      ctrlRows.length
        ? `<table class="cmp-table"><thead><tr><th>Control</th><th class="num">A</th><th class="hide-sm">Variación</th><th class="num">B</th><th class="num">Δ</th></tr></thead><tbody>${ctrlRows
            .map((x) => {
              const w = x.delta ? (Math.abs(x.delta) / maxAbs) * 50 : 0;
              return `<tr><td><span class="id">${esc(x.id)}.</span> ${esc(x.name)}</td>
              <td class="num">${x.a == null ? '—' : fmt(x.a)}</td>
              <td class="hide-sm"><div class="dbar" aria-hidden="true">${x.delta ? `<i class="${x.delta > 0 ? 'up' : 'down'}" style="width:${w}%"></i>` : ''}</div></td>
              <td class="num">${x.b == null ? '—' : fmt(x.b)}</td>
              <td class="num">${x.delta == null ? '—' : deltaSpan(x.delta)}</td></tr>`;
            })
            .join('')}</tbody></table>`
        : '<p class="muted small">Ningún control cambió de puntaje entre A y B.</p>'
    }
  </div>`;

  const order = { mejora: 0, retroceso: 1, neutral: 2, nueva: 3, eliminada: 4 };
  const changes = [...c.changes].sort((x, y) => order[x.direction] - order[y.direction] || x.id.localeCompare(y.id, 'es', { numeric: true }));
  const sgs = `<div class="cmp-section">
    <h3>Salvaguardas que cambiaron <span class="muted small">${changes.length}</span></h3>
    ${
      changes.length
        ? `<table class="cmp-table"><thead><tr><th>ID</th><th>Salvaguarda</th><th>Estado A → B</th><th class="num">Cambio</th></tr></thead><tbody>${changes
            .map(
              (x) => `<tr><td class="id"><button class="link-btn" data-goto="${esc(x.id)}">${esc(x.id)}</button></td>
              <td>${esc(x.title)}${x.applied ? '<span class="tag-applied">· aplicado</span>' : ''}</td>
              <td><span class="arrow-st">${x.from ? statusChip(x.from) : '—'} → ${x.to ? statusChip(x.to) : '—'}</span></td>
              <td class="num"><span class="dir ${x.direction}">${esc(x.direction)}</span></td></tr>`
            )
            .join('')}</tbody></table>`
        : '<p class="muted small">No hay diferencias entre A y B.</p>'
    }
  </div>`;

  $('#cmp-body').innerHTML = hero + counts + controls + sgs;
}

async function saveVersion(label) {
  try {
    setSnap(await api('POST', '/api/versions', { label }));
    const v = ui.snap.versions.at(-1);
    ui.cmpA = v.id;
    ui.cmpB = 'current';
    render();
    toast(`Versión v${v.n} guardada.`);
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------- Chat ----------------

function md(text) {
  const lines = esc(text).split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_(.+?)_(?=[\s.,)]|$)/g, '$1<em>$2</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (li) {
      if (!inList) (html += '<ul>'), (inList = true);
      html += `<li>${li[1]}</li>`;
      continue;
    }
    if (inList) (html += '</ul>'), (inList = false);
    if (line.trim()) html += `<p>${line.replace(/^#+\s*/, '')}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

function msgHtml(m) {
  if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.content)}</div></div>`;
  if (m.role === 'system') return `<div class="msg system"><div class="bubble">${esc(m.content)}</div></div>`;
  const actions = m.actions?.length
    ? `<div class="actions">${m.actions
        .map((a) => {
          const delta = a.before != null && a.after != null ? ` · índice ${fmt(a.before)} → <strong>${fmt(a.after)}</strong>` : '';
          return `<div class="action"><span aria-hidden="true">⚡</span><span>${esc(a.text)}${delta}</span><button class="go" data-view="dashboard">Ver dashboard →</button></div>`;
        })
        .join('')}</div>`
    : '';
  return `<div class="msg assistant"><img class="avatar" src="logo.svg" alt="Cyber Cactus" /><div class="bubble">${md(m.content)}${actions}</div></div>`;
}

function scrollChat() {
  const s = $('#chat-scroll');
  requestAnimationFrame(() => (s.scrollTop = s.scrollHeight));
}

function renderChat() {
  $('#welcome').hidden = ui.chat.length > 0;
  $('#chat-log').innerHTML =
    ui.chat.map(msgHtml).join('') +
    (ui.busy ? `<div class="msg assistant"><img class="avatar" src="logo.svg" alt="" /><div class="typing-dots" aria-label="Cyber Cactus está escribiendo"><i></i><i></i><i></i></div></div>` : '');
  local.set('cc-chat', ui.chat.slice(-60));
  scrollChat();
}

function pushMsg(m) {
  ui.chat.push(m);
  renderChat();
}

function renderSuggestions() {
  const s = ui.snap;
  const name = s.catalog.shortName;
  let items;
  if (!s.documents.length) {
    items = [
      { label: '📎 Adjuntar la documentación de la organización', action: 'attach' },
      { label: `¿Qué documentos te sirven para evaluar ${name}?` },
      { label: '¿Cómo calculás el índice de cumplimiento?' },
    ];
  } else if (!s.analysis) {
    items = [{ label: '🔎 Analizá la documentación', action: 'analyze' }, { label: '¿Qué documentos tenés cargados?' }];
  } else {
    items = [
      { label: '¿Qué tan mal está la organización?' },
      { label: '¿Qué salvaguardas conviene implementar primero?' },
      { label: '¿Qué salvaguardas no tienen evidencia?' },
      { label: 'Ya implementamos MFA para el acceso remoto por VPN' },
    ];
  }
  $('#suggestions').innerHTML = items
    .map((i) => `<button class="suggestion" ${i.action ? `data-sugg-action="${i.action}"` : ''} data-sugg="${esc(i.label)}">${esc(i.label)}</button>`)
    .join('');
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
    pushMsg({ role: 'assistant', content: `Se me trabó la investigación: ${e.message}` });
  } finally {
    $('#chat-send').disabled = false;
  }
}

// ---------------- Documentos y análisis ----------------

const ANALYSIS_STEPS = () => {
  const c = ui.snap.catalog;
  return [
    'Leyendo la fuente de verdad…',
    `Comparando contra ${c.safeguards.length} salvaguardas de ${c.shortName}…`,
    'Buscando evidencia textual en los documentos…',
    'Verificando cada cita contra el texto original…',
    'Calculando el índice de cumplimiento…',
  ];
};

/** Sube archivos y, si se subió algo, lanza el análisis. El círculo de carga cubre todo el proceso. */
async function uploadFiles(files) {
  if (!files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
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
  pushMsg({ role: 'system', content: `📄 ${added.join(', ')} ${added.length > 1 ? 'agregados' : 'agregado'} a la fuente de verdad.` });
  await runAnalysis();
}

async function runAnalysis() {
  if (!ui.snap.documents.length) return;
  setView('chat');
  showLoader('Cyber Cactus está analizando la documentación', ANALYSIS_STEPS());
  const before = current()?.index;
  try {
    setSnap(await api('POST', '/api/analyze'));
    const d = current();
    pushMsg({
      role: 'assistant',
      content:
        `Caso abierto: **${d.company.name === 'No informado' ? 'la organización' : d.company.name}** contra ${d.total} salvaguardas de ${ui.snap.catalog.shortName}. ` +
        `Índice de cumplimiento **${fmt(d.index)}/100** (${d.label.label}).\n\n` +
        `- ${d.counts.implementado} implementadas, ${d.counts.parcial} parciales, ${d.counts.no_implementado} no implementadas\n` +
        `- ${d.counts.sin_evidencia} sin evidencia en los documentos\n\n` +
        (d.priorities[0] ? `Primera pista a seguir: **${d.priorities[0].id} · ${d.priorities[0].title}**.` : ''),
      actions: [{ text: 'Dashboard actualizado', before: before ?? null, after: d.index }],
    });
  } catch (e) {
    toast(e.message, true);
  } finally {
    hideLoader();
  }
}

async function downloadPdf() {
  showLoader('Generando el PDF ejecutivo…', ['Completando la plantilla con el dashboard…', 'Imprimiendo el documento…']);
  try {
    const res = await fetch('/api/report.pdf');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
    const blob = await res.blob();
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'Informe.pdf';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('PDF ejecutivo descargado.');
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
  render(); // recalcula el dashboard al instante
  try {
    ui.snap = await api('PUT', `/api/safeguards/${encodeURIComponent(id)}`, { status });
  } catch (e) {
    ui.overrides = prev;
    render();
    toast(e.message, true);
  }
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

// ---------------- Eventos ----------------

// Menú del clip
const menu = $('#attach-menu');
const toggleMenu = (open) => {
  menu.hidden = !open;
  $('#chat-attach').setAttribute('aria-expanded', open);
  if (open) menu.querySelector('button').focus();
};
$('#chat-attach').addEventListener('click', () => toggleMenu(menu.hidden));
document.addEventListener('click', (e) => {
  if (!menu.hidden && !e.target.closest('.attach-wrap')) toggleMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) {
    toggleMenu(false);
    $('#chat-attach').focus();
  }
});
menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-attach]');
  if (!b) return;
  toggleMenu(false);
  if (b.dataset.attach === 'file') $('#file-input').click();
  else $('#paste-dialog').showModal();
});

$('#file-input').addEventListener('change', (e) => {
  uploadFiles([...e.target.files]);
  e.target.value = '';
});

// Arrastrar archivos sobre el chat
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
  if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]);
});

// Pegar texto
$('#paste-cancel').addEventListener('click', () => $('#paste-dialog').close());
$('#paste-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#paste-name').value.trim() || 'Nota';
  const text = $('#paste-text').value;
  $('#paste-dialog').close();
  showLoader('Agregando el texto a la fuente de verdad…');
  try {
    setSnap(await api('POST', '/api/documents/text', { name, text }));
    $('#paste-name').value = $('#paste-text').value = '';
    pushMsg({ role: 'system', content: `📄 ${name} agregado a la fuente de verdad.` });
    await runAnalysis();
  } catch (err) {
    toast(err.message, true);
  } finally {
    hideLoader();
  }
});

$('#btn-analyze').addEventListener('click', runAnalysis);
$('#btn-save-version').addEventListener('click', () => {
  const name = prompt('Nombre de la versión (ej. "Después de MFA"):', '');
  if (name !== null) saveVersion(name);
});
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
$('#btn-pdf').addEventListener('click', downloadPdf);

$('#model-select').addEventListener('change', async (e) => {
  const model = e.target.value;
  try {
    setSnap(await api('PUT', '/api/settings', { model }));
    toast(
      ui.snap.agent.llm
        ? `Modelo: ${model}.${ui.snap.analysis ? ' Volvé a analizar para recalcular el diagnóstico con este modelo.' : ''}`
        : `Modelo: ${model}. Se usará cuando configures OPENAI_API_KEY.`
    );
  } catch (err) {
    toast(err.message, true);
    render();
  }
});

$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('¿Borrar todos los documentos, el análisis, los controles aplicados, las versiones y el chat?')) return;
  ui.chat = [];
  ui.open.clear();
  setSnap(await api('POST', '/api/reset'));
  renderChat();
});

// Recordar qué grupos de salvaguardas están abiertos.
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
    if (!confirm(`¿Restaurar v${v.n} (${v.label})? El diagnóstico y los controles aplicados vuelven a ese momento. Los documentos cargados no cambian. Si querés conservar el estado actual, guardalo antes como versión.`)) return;
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
    if (!confirm(`¿Eliminar la versión v${v.n} (${v.label})?`)) return;
    return setSnap(await api('DELETE', `/api/versions/${ds.delVersion}`));
  }
  if (ds.delDoc) return setSnap(await api('DELETE', `/api/documents/${ds.delDoc}`));
  if (ds.sg) return setSafeguard(ds.sg, ds.status);
  if (ds.goto) return gotoSafeguard(ds.goto);
  if (ds.suggAction === 'attach') return $('#file-input').click();
  if (ds.suggAction === 'analyze') return runAnalysis();
  if (ds.sugg) return sendChat(ds.sugg);
  if (ds.ask) {
    const s = ui.snap.catalog.safeguards.find((x) => x.id === ds.ask);
    setView('chat');
    return sendChat(`Contame sobre la salvaguarda ${ds.ask}${s ? ` (${s.title})` : ''}: qué evidencia hay en los documentos y qué haría falta para implementarla.`);
  }
  if (ds.sfilter) {
    ui.sfilter = ds.sfilter;
    document.querySelectorAll('[data-sfilter]').forEach((b) => b.classList.toggle('on', b === t));
    return render();
  }
});

// Composer: Enter envía, Shift+Enter hace salto de línea, el textarea crece.
const input = $('#chat-input');
const grow = () => {
  input.style.height = 'auto';
  input.style.height = Math.min(180, input.scrollHeight) + 'px';
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
renderChat();
api('GET', '/api/state')
  .then(setSnap)
  .catch((e) => toast(e.message, true));
