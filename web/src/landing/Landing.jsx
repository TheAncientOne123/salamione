import { useEffect, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import { CountUp } from '../lib/ui.jsx';

// Páginas oficiales de CIS (Center for Internet Security), verificadas.
export const CIS = {
  controls: 'https://www.cisecurity.org/controls',
  v81: 'https://www.cisecurity.org/controls/v8-1',
  list: 'https://www.cisecurity.org/controls/cis-controls-list',
  igs: 'https://www.cisecurity.org/controls/implementation-groups',
  ig1: 'https://www.cisecurity.org/controls/implementation-groups/ig1',
  ig2: 'https://www.cisecurity.org/controls/implementation-groups/ig2',
  ig3: 'https://www.cisecurity.org/controls/implementation-groups/ig3',
  download: 'https://learn.cisecurity.org/cis-controls-download',
};
const Ext = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="ext">
    {children}
  </a>
);

const up = (d = 0) => ({ initial: { opacity: 0, y: 18 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-40px' }, transition: { duration: 0.5, delay: d, ease: [0.16, 1, 0.3, 1] } });

export default function Landing() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {});
  }, []);
  const cta = user ? { href: '/app', label: 'Abrir SalamiOne' } : { href: '/registro', label: 'Crear cuenta' };

  return (
    <MotionConfig reducedMotion="user">
      <header className="nav">
        <div className="wrap">
          <a className="logo" href="/">
            <img src="/logo.svg" alt="" width="34" height="34" />
            <span>
              Salami<b>One</b>
            </span>
          </a>
          <nav className="nav-links" aria-label="Principal">
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#funciones">Funciones</a>
            <a href="#alcance">IG1 · IG2 · IG3</a>
            <a href="#preguntas">Preguntas</a>
            <a className="nav-keep" href={user ? '/app' : '/login'}>
              {user ? 'Abrir SalamiOne' : 'Iniciar sesión'}
            </a>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="wrap">
          <div>
            <motion.p className="eyebrow" {...up()}>
              Asesor de <Ext href={CIS.v81}>CIS Controls v8.1</Ext>
            </motion.p>
            <motion.h1 {...up(0.05)}>
              Tu postura de ciberseguridad, <em>medida con evidencia</em>.
            </motion.h1>
            <motion.p className="lead" {...up(0.12)}>
              SalamiOne lee tus políticas, informes e inventarios (o lo que le cuentes en el chat), evalúa cada salvaguarda de los <Ext href={CIS.controls}>CIS Critical Security Controls</Ext> con citas verificadas y te muestra si los cambios mejoraron o empeoraron la postura.
            </motion.p>
            <motion.div className="cta" {...up(0.18)}>
              <a className="btn primary" href={cta.href}>
                {user ? cta.label : 'Crear cuenta gratis'}
              </a>
              <a className="btn line" href="#como-funciona">
                Ver cómo funciona
              </a>
            </motion.div>
            <motion.p className="fine" {...up(0.24)}>
              Usa tu propia IA: OpenAI, Claude, Gemini o un modelo local con Ollama.
            </motion.p>
          </div>

          <motion.figure className="sample" aria-label="Ejemplo de comparación con el caso de muestra" initial={{ opacity: 0, y: 30, rotate: 2 }} animate={{ opacity: 1, y: 0, rotate: -1 }} transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}>
            <div className="sample-head">
              <b>Distribuidora Andina S.A.</b>
              <span>
                <span className="tag">IG1</span> <span className="tag soft">caso de ejemplo</span>
              </span>
            </div>
            <div className="sample-kpis">
              <div className="kpi">
                <small>Antes · implementación</small>
                <strong>12,5%</strong>
              </div>
              <div className="arrow" aria-hidden="true">
                →
              </div>
              <div className="kpi after">
                <small>Después · implementación</small>
                <strong>
                  <CountUp value={36.4} suffix="%" />
                </strong>
              </div>
            </div>
            <motion.div className="verdict" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1 }}>
              <b>Mejoró</b>
              <span>+23,9 pts tras el avance de iniciativas · cobertura 35,7% → 39,3%</span>
            </motion.div>
            <div className="bars" aria-label="Ejemplos de salvaguardas evaluadas">
              {[
                ['6.3', 100, '#d03b3b', 'No impl.'],
                ['11.2', 100, '#0ca30c', 'Impl.'],
                ['14.1', 50, '#fab219', 'Parcial'],
                ['8.2', 100, '#bfc2c8', 'No verif.'],
              ].map(([id, w, c, l], k) => (
                <div className="bar" key={id}>
                  <span className="id">{id}</span>
                  <div className="track">
                    <motion.i style={{ background: c }} initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ delay: 0.6 + k * 0.1, duration: 0.6 }} />
                  </div>
                  <span className="v">{l}</span>
                </div>
              ))}
            </div>
            <figcaption className="sample-foot">Cifras del caso de muestra incluido en la app, evaluado con IA. Cada estado lleva su cita textual y la página del documento.</figcaption>
          </motion.figure>
        </div>
      </section>

      <main>
        <section className="block" id="como-funciona">
          <div className="wrap">
            <motion.div className="sec-head" {...up()}>
              <p className="eyebrow">Cómo funciona</p>
              <h2>Del documento al dashboard en tres pasos</h2>
            </motion.div>
            <div className="steps">
              {[
                ['Carga la evidencia', 'Sube PDF, DOCX o TXT, pega texto o describe la organización en el chat. Elige el Implementation Group objetivo para cada evaluación.'],
                ['SalamiOne evalúa', 'Primero arma la ficha de contexto y después califica cada salvaguarda. Las citas que no aparecen en el texto se descartan y el estado pasa a "No verificado".'],
                ['Decide y compara', 'Exporta el dashboard, comparte el resumen ejecutivo y, cuando lleguen nuevas evidencias, compara la versión anterior con la nueva.'],
              ].map(([t, p], k) => (
                <motion.article className="step" key={t} {...up(0.08 * k)}>
                  <h3>{t}</h3>
                  <p>{p}</p>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        <section className="block" id="funciones">
          <div className="wrap">
            <motion.div className="sec-head" {...up()}>
              <p className="eyebrow">Funciones</p>
              <h2>Todo lo que necesita una evaluación CIS, en un solo lugar</h2>
            </motion.div>
            <div className="features">
              {[
                ['Chat experto en CIS v8.1', 'Pregunta por controles, salvaguardas o tu evaluación. Si describes tu organización, arma el dashboard con lo que escribiste.'],
                ['Dashboard con evidencia', 'Implementación, cobertura, mapa por control, cinco riesgos y un roadmap de cinco iniciativas, con la cita de cada conclusión.'],
                ['Exporta a PDF y Excel', 'El dashboard completo en PDF o en un Excel con hojas de resumen, controles, salvaguardas, riesgos, roadmap y contexto.'],
                ['Resumen ejecutivo', 'Una carta lista para la dirección: indicadores, riesgos, recomendaciones, incertidumbres y conclusión.'],
                ['Versiones en tres pasos', 'Elige la versión anterior y la nueva: verás si mejoró o empeoró, qué salvaguardas cambiaron y cómo quedaron los riesgos.'],
                ['Fuentes bajo control', 'Revisa el texto extraído de cada archivo, descárgalo o elimínalo, y rehaz la evaluación con las fuentes correctas.'],
              ].map(([t, p], k) => (
                <motion.article className="feature" key={t} {...up(0.05 * k)}>
                  <h3>{t}</h3>
                  <p>{p}</p>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        <section className="block" id="alcance">
          <div className="wrap">
            <motion.div className="sec-head" {...up()}>
              <p className="eyebrow">Alcance</p>
              <h2>
                Los tres <Ext href={CIS.igs}>Implementation Groups</Ext> de CIS Controls v8.1
              </h2>
              <p>
                Cada evaluación elige su IG. Los grupos son acumulativos: IG2 incluye IG1 e IG3 incluye a los dos, sobre los <Ext href={CIS.list}>18 CIS Controls</Ext>.
              </p>
            </motion.div>
            <div className="igs">
              {[
                ['ig1', 56, 'IG1 · Higiene esencial', 'El mínimo que toda organización debería cumplir. Pymes y equipos de TI pequeños.', '15 controles · sin 13, 16 y 18'],
                ['ig2', 130, 'IG2 · Organizaciones con datos sensibles', 'Varias áreas o sedes, datos de clientes y requisitos regulatorios.', '18 controles'],
                ['ig3', 153, 'IG3 · Alta exposición', 'Equipos de seguridad propios y servicios o datos críticos.', '18 controles · catálogo completo'],
              ].map(([k, n, t, p, c], i) => (
                <motion.article className="ig" key={k} {...up(0.08 * i)}>
                  <p className="n">
                    <CountUp value={n} decimals={0} />
                    <small>salvaguardas</small>
                  </p>
                  <h3>{t}</h3>
                  <p>{p}</p>
                  <p className="ctrls">{c}</p>
                  <Ext href={CIS[k]}>Ver {k.toUpperCase()} en cisecurity.org ↗</Ext>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        <section className="block">
          <div className="wrap two">
            <motion.div className="sec-head" {...up()}>
              <p className="eyebrow">Tu modelo, tus datos</p>
              <h2>Conecta la IA que ya usas</h2>
              <p>Cada usuario conecta su proveedor con su propia API key, que se guarda cifrada. Para datos que no deben salir de tu red, usa un modelo local.</p>
              <div className="providers">
                {['OpenAI', 'Anthropic Claude', 'Google Gemini', 'Ollama (local)', 'LM Studio', 'OpenRouter', 'Azure OpenAI'].map((p) => (
                  <span key={p}>{p}</span>
                ))}
              </div>
            </motion.div>
            <motion.ul className="checks" {...up(0.1)}>
              <li>
                <b>Sin invenciones.</b> Los esquemas limitan IDs y estados al catálogo, y cada cita se busca en el texto original.
              </li>
              <li>
                <b>Cuentas separadas.</b> Inicio de sesión con contraseña cifrada; cada usuario ve solo sus evaluaciones.
              </li>
              <li>
                <b>Funciona sin IA.</b> Un motor demo de reglas recorre las mismas etapas si tu proveedor no responde.
              </li>
              <li>
                <b>Documentos como datos.</b> Las instrucciones escritas dentro de un documento se ignoran.
              </li>
            </motion.ul>
          </div>
        </section>

        <section className="block" id="preguntas">
          <div className="wrap">
            <motion.div className="sec-head" {...up()}>
              <h2>Preguntas frecuentes</h2>
            </motion.div>
            <div className="faq">
              {[
                ['¿SalamiOne certifica el cumplimiento de CIS Controls?', <>No. Es una evaluación documental: "Implementado" significa que la documentación lo sustenta, sujeto a la validación de un auditor. El marco oficial está en <Ext href={CIS.v81}>cisecurity.org</Ext>.</>],
                ['¿De dónde sale el catálogo de salvaguardas?', <>De CIS Controls v8.1, con descripciones resumidas en español. El documento oficial completo se descarga desde la <Ext href={CIS.download}>página de descarga de CIS</Ext>.</>],
                ['¿Qué pasa si un documento no menciona una salvaguarda?', 'Queda como "No verificado". No baja el indicador de implementación, pero sí la cobertura, y aparece como información pendiente.'],
                ['¿Puedo evaluar sin subir documentos?', 'Sí. Describe la organización en el chat y pide el dashboard. Tus mensajes se guardan como fuente y las citas se verifican contra ellos.'],
                ['¿Cómo sé si los cambios mejoraron la postura?', 'Sube la nueva evidencia, aprueba los cambios y abre Versiones: eliges la versión anterior, la nueva y ves el veredicto con el detalle de lo que cambió.'],
                ['¿Cuánto cuesta la IA?', 'Lo que cobre tu proveedor por tu propia API key. Con un modelo local (Ollama) no hay costo por uso.'],
              ].map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>


      <footer>
        <div className="wrap">
          <span>© 2026 SalamiOne</span>
          <span className="foot-links">
            <Ext href={CIS.controls}>CIS Controls</Ext>
            <Ext href={CIS.v81}>Versión 8.1</Ext>
            <Ext href={CIS.igs}>Implementation Groups</Ext>
            <Ext href={CIS.download}>Descarga oficial</Ext>
          </span>
          <span>CIS Controls® es marca de Center for Internet Security, Inc. SalamiOne no está afiliado a CIS.</span>
        </div>
      </footer>
    </MotionConfig>
  );
}
