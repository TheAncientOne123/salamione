// Selector de modelo: campo editable + lista desplegable con TODOS los modelos de la cuenta.
// Al abrir muestra la lista completa (no filtra por lo que ya está escrito); filtra solo cuando el usuario escribe.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export default function ModelPicker({ value, onChange, models, recommended, placeholder, onRequestModels, loading }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(null); // null = sin filtrar (recién abierto)
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const list = useRef(null);

  const shown = query ? models.filter((m) => m.toLowerCase().includes(query.toLowerCase())) : models;

  useEffect(() => {
    if (!open) return;
    const off = (e) => !box.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);

  // Al abrir, resalta el modelo actual.
  useEffect(() => {
    if (open) setActive(Math.max(0, shown.indexOf(value)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (m) => {
    onChange(m);
    setOpen(false);
    setQuery(null);
  };

  const toggle = () => {
    if (!models.length) return onRequestModels?.();
    setQuery(null);
    setOpen((o) => !o);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return toggle();
      setActive((a) => Math.min(shown.length - 1, Math.max(0, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && open && shown[active]) {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="mp" ref={box}>
      <div className="mp-field">
        <input
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls="mp-list"
          aria-autocomplete="list"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setQuery(e.target.value);
            setActive(0);
            if (models.length) setOpen(true);
          }}
          onKeyDown={onKey}
        />
        <button type="button" className="mp-toggle" onClick={toggle} aria-label={models.length ? 'Ver todos los modelos' : 'Cargar modelos disponibles'} title={models.length ? 'Ver todos los modelos' : 'Cargar modelos disponibles'}>
          {loading ? <span className="mini-spin" /> : <span aria-hidden="true">{open ? '▴' : '▾'}</span>}
        </button>
        <AnimatePresence>
          {open && (
            <motion.ul
              id="mp-list"
              ref={list}
              className="mp-list"
              role="listbox"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
            >
              {shown.length ? (
                shown.map((m, k) => (
                  <li
                    key={m}
                    role="option"
                    aria-selected={m === value}
                    data-active={k === active}
                    className={`${k === active ? 'active' : ''}${m === value ? ' selected' : ''}`}
                    onMouseEnter={() => setActive(k)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(m);
                    }}
                  >
                    <span className="mp-name">{m}</span>
                    {m === recommended && <span className="mp-tag">recomendado</span>}
                  </li>
                ))
              ) : (
                <li className="mp-empty">Ningún modelo coincide con "{query}". Puedes usarlo igual si existe en tu cuenta.</li>
              )}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
      {models.length > 0 && <small className="muted">{models.length} modelos de texto en tu cuenta · abre la lista con ▾ o escribe para buscar.</small>}
    </div>
  );
}
