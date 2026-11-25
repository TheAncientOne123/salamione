// Tutorial guiado: resalta un elemento de la interfaz por paso y muestra una tarjeta explicativa.
// steps: [{ title, text, target?, view?, needs?, action?: {label, run}, hideAction? }]
const $ = (s) => document.querySelector(s);

export function startTour(allSteps, { onView, onDone } = {}) {
  const steps = allSteps.filter((s) => !s.needs || s.needs());
  const tour = $('#tour');
  const spot = $('#tour-spot');
  const card = $('#tour-card');
  let i = 0;

  function place() {
    const s = steps[i];
    const el = s.target && document.querySelector(s.target);
    const visible = el && el.getClientRects().length;
    tour.classList.toggle('centered', !visible);
    if (!visible) {
      spot.hidden = true;
      card.style.left = card.style.top = '';
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 6;
    spot.hidden = false;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const cw = Math.min(360, window.innerWidth - 32);
    const ch = card.offsetHeight || 200;
    let top = r.bottom + 14;
    if (top + ch > window.innerHeight - 16) top = Math.max(16, r.top - ch - 14);
    const left = Math.min(Math.max(16, r.left + r.width / 2 - cw / 2), window.innerWidth - cw - 16);
    Object.assign(card.style, { left: `${left}px`, top: `${top}px`, width: `${cw}px` });
  }

  function show() {
    const s = steps[i];
    if (s.view) onView?.(s.view);
    $('#tour-step').textContent = `Paso ${i + 1} de ${steps.length}`;
    $('#tour-title').textContent = s.title;
    $('#tour-text').textContent = s.text;
    $('#tour-prev').hidden = i === 0;
    const last = i === steps.length - 1;
    const act = s.action && !(s.hideAction && s.hideAction());
    $('#tour-next').textContent = act ? s.action.label : last ? 'Empezar' : 'Siguiente';
    requestAnimationFrame(place);
    $('#tour-next').focus();
  }

  function end() {
    tour.hidden = true;
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey);
    onDone?.();
  }

  function next() {
    const s = steps[i];
    if (s.action && !(s.hideAction && s.hideAction())) {
      end();
      return s.action.run();
    }
    if (i === steps.length - 1) return end();
    i++;
    show();
  }

  const onKey = (e) => {
    if (e.key === 'Escape') end();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft' && i > 0) (i--, show());
  };

  $('#tour-next').onclick = next;
  $('#tour-prev').onclick = () => (i--, show());
  $('#tour-skip').onclick = end;
  window.addEventListener('resize', place);
  document.addEventListener('keydown', onKey);
  tour.hidden = false;
  show();
}
