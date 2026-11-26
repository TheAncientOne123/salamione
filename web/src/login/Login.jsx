import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';

export default function Login() {
  const [register, setRegister] = useState(location.pathname === '/registro');
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const first = useRef(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then(({ user }) => user && (location.href = '/app'))
      .catch(() => {});
  }, []);
  useEffect(() => {
    history.replaceState(null, '', register ? '/registro' : '/login');
    setError(null);
    first.current?.focus();
  }, [register]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch(register ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(register ? form : { email: form.email, password: form.password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      location.href = '/app';
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <main className="auth">
        <motion.div className="auth-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <a className="logo auth-logo" href="/" aria-label="SalamiOne, inicio">
            <motion.img src="/logo.svg" alt="" width="56" height="56" initial={{ rotate: -90, scale: 0.7 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 14 }} />
            <span>
              Salami<b>One</b>
            </span>
          </a>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={register ? 'r' : 'l'} className="auth-head" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <h1>{register ? 'Crea tu cuenta' : 'Inicia sesión'}</h1>
              <p>{register ? 'Evalúa CIS Controls v8.1 con evidencia y compara versiones.' : 'Retoma tus evaluaciones de CIS Controls v8.1.'}</p>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.p className="auth-error" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <form onSubmit={submit}>
            <AnimatePresence initial={false}>
              {register && (
                <motion.label key="name" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  Nombre
                  <input ref={register ? first : null} autoComplete="name" required maxLength={80} value={form.name} onChange={set('name')} />
                </motion.label>
              )}
            </AnimatePresence>
            <label>
              Correo
              <input ref={register ? null : first} type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
            </label>
            <label>
              Contraseña
              <input type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : undefined} value={form.password} onChange={set('password')} />
            </label>
            {register && <p className="auth-note">Mínimo 8 caracteres.</p>}
            <p className="auth-switch">
              {register ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'}{' '}
              <button type="button" className="auth-link" onClick={() => setRegister(!register)}>
                {register ? 'Inicia sesión' : 'Crea una cuenta'}
              </button>
            </p>
            <button className="btn primary" type="submit" disabled={sending}>
              {sending ? 'Un momento…' : register ? 'Crear cuenta' : 'Entrar'}
            </button>
          </form>
          <p className="auth-note auth-back">
            <a href="/">Volver al inicio</a>
          </p>
        </motion.div>
      </main>
    </MotionConfig>
  );
}
