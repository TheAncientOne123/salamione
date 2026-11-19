// Motor de respaldo SIN OpenAI: busca en la documentación frases relacionadas con cada
// salvaguarda del catálogo CIS. Es solo para demos; su salida pasa por el mismo verificador.
//
// Las palabras clave son una ayuda de búsqueda (no definen dominios ni controles: eso viene del catálogo).
// Si el catálogo trae una salvaguarda sin palabras clave acá, queda "sin_evidencia".

import { fmt, STATUS } from '../public/scoring.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const NEGATION = /\b(no|sin|nunca|carece|carecemos|falta|faltan|pendiente|desactualizad[oa]s?|vencid[oa]s?|inexistente|ningun[oa]?|tampoco|deficiente|insuficiente|improvis\w*)\b/;

// re: frases relacionadas con la salvaguarda · bad: frases que describen una mala práctica explícita
const KEYWORDS = {
  '1.1': { re: /inventario de (equipos|activos|hardware|dispositivos)/ },
  '1.2': { re: /(activos?|dispositivos?|equipos?) no autorizad/ },
  '2.1': { re: /inventario de software|software instalado/ },
  '2.2': { re: /sin soporte|soporte (del fabricante|vigente)|fin de vida|obsolet|windows (xp|7|server 200[38])/, bad: /sin soporte|obsolet|windows (xp|7|server 200[38])/ },
  '2.3': { re: /software no autorizado|software pirata|instalan (programas|software)/ },
  '3.1': { re: /gestion de (los )?datos|clasificacion de (la )?informacion|politica de datos/ },
  '3.2': { re: /inventario de datos|datos sensibles|datos personales|base de clientes/ },
  '3.3': { re: /permisos de acceso|acceso a (los )?datos|carpetas compartidas|necesidad de conocer/ },
  '3.4': { re: /retencion de (los )?datos|plazos? de conservacion/ },
  '3.5': { re: /eliminacion segura|borrado seguro|destruccion de (datos|documentos)/ },
  '3.6': { re: /cifrado de disco|bitlocker|filevault|discos? cifrad/ },
  '4.1': { re: /configuracion segura|hardening|bastionado/ },
  '4.2': { re: /configuracion (segura )?de (la )?red|configuracion de (routers?|switch)/ },
  '4.3': { re: /bloqueo (automatico )?de (sesion|pantalla)/ },
  '4.4': { re: /firewall (en|de) (los )?servidor|servidores? [^.]*firewall/ },
  '4.5': { re: /firewall (en|de) (las |los )?(pc|equipos|computadoras|notebooks)/ },
  '4.6': { re: /\bssh\b|\btelnet\b|administracion remota/ },
  '4.7': { re: /cuentas? (predeterminad|por defecto)|contrasenas? (de fabrica|por defecto)/ },
  '5.1': { re: /inventario de cuentas|listado de (usuarios|cuentas)/ },
  '5.2': { re: /contrasenas?/, bad: /compartid|no se cambian|misma contrasena/ },
  '5.3': { re: /cuentas? inactivas|usuarios? de (ex ?)?empleados|empleados que se fueron/ },
  '5.4': { re: /privilegios de administrador|cuentas? de administrador|administrador local/, bad: /todos [^.]*administrador|permisos de administrador local/ },
  '6.1': { re: /alta de usuarios|otorgamiento de acceso|alta de accesos?/ },
  '6.2': { re: /baja de usuarios|dan de baja|revocacion de acceso|egreso de personal/ },
  '6.3': { re: /doble factor|multifactor|\bmfa\b|\b2fa\b/ },
  '6.4': { re: /\bvpn\b|acceso remoto/ },
  '6.5': { re: /doble factor|multifactor|\bmfa\b|\b2fa\b/ },
  '7.1': { re: /gestion de vulnerabilidades|escaneo de vulnerabilidades/ },
  '7.2': { re: /remediacion de vulnerabilidades|vulnerabilidades/ },
  '7.3': { re: /parches|actualizaciones (del sistema|de windows|automaticas del sistema)/ },
  '7.4': { re: /actualizaciones de (las )?aplicaciones|parches de aplicaciones/ },
  '8.1': { re: /registros? de auditoria|gestion de (logs|registros)/ },
  '8.2': { re: /\blogs?\b|registros? de (eventos|auditoria)/ },
  '8.3': { re: /almacenamiento de (logs|registros)|retencion de logs/ },
  '9.1': { re: /navegador(es)?|cliente de correo|correo corporativo/ },
  '9.2': { re: /filtrado dns|filtro dns/ },
  '10.1': { re: /antivirus|antimalware|\bedr\b/ },
  '10.2': { re: /firmas (del antivirus|antimalware)|antivirus [^.]*actualiz/ },
  '10.3': { re: /autoejecucion|autorun|autoplay|pendrives?|medios removibles/ },
  '11.1': { re: /recuperacion (de datos|ante desastres)|plan de recuperacion|proceso de recuperacion/ },
  '11.2': { re: /backups?|copias? de seguridad|respaldos?/ },
  '11.3': { re: /(backups?|respaldos?|copias?) cifrad|proteccion de (los )?respaldos/ },
  '11.4': { re: /fuera de sitio|offline|disco externo|copia aislada/ },
  '12.1': { re: /infraestructura de red|firmware|routers?|switch(es)?/ },
  '14.1': { re: /concientizacion|concienciacion|capacitacion en seguridad/ },
  '14.2': { re: /phishing|ingenieria social/ },
  '14.3': { re: /capacitacion [^.]*(contrasenas|autenticacion)/ },
  '14.4': { re: /capacitacion [^.]*manejo de datos/ },
  '14.5': { re: /exposicion (no intencional )?de datos|envio erroneo|perdida de dispositivos/ },
  '14.6': { re: /capacitacion [^.]*incidentes|reconocer (y reportar )?incidentes/ },
  '14.7': { re: /reportar actualizaciones|actualizaciones pendientes/ },
  '14.8': { re: /redes? (inseguras|publicas|wifi|domesticas)|teletrabajo|trabajo remoto/ },
  '15.1': { re: /inventario de proveedores|proveedores de servicios/ },
  '17.1': { re: /responsable (designado|de (los )?incidentes)|encargado de (seguridad|incidentes)/ },
  '17.2': { re: /contactos? (para|de) (reportar )?incidentes|directorio de contactos/ },
  '17.3': { re: /(procedimiento|proceso) (para|de) (reportar|reporte|respuesta)[^.]*incidentes|reportar incidentes/ },
};

function sentences(documents) {
  const out = [];
  for (const d of documents) {
    for (const s of d.text.split(/(?<=[.!?;])\s+|\n+/)) {
      const t = s.replace(/^[#>*\-\s]+/, '').trim();
      if (t.length > 8) out.push({ doc: d.name, text: t, n: norm(t) });
    }
  }
  return out;
}

const quote = (s) => ({ document: s.doc, quote: s.text.length > 300 ? s.text.slice(0, 300) : s.text });

/** Devuelve la misma forma que el modelo: { company, safeguards: [{id, status, rationale, evidence}] } */
export function heuristicAnalysis(documents, catalog) {
  const sents = sentences(documents);
  const safeguards = catalog.safeguards.map((s) => {
    const k = KEYWORDS[s.id];
    const hits = k ? sents.filter((x) => k.re.test(x.n)) : [];
    const neg = hits.filter((x) => NEGATION.test(x.n) || (k.bad && k.bad.test(x.n)));
    const pos = hits.filter((x) => !neg.includes(x));
    let status = 'sin_evidencia';
    let rationale = 'La documentación no menciona esta salvaguarda.';
    if (neg.length && !pos.length) {
      status = 'no_implementado';
      rationale = 'La documentación indica que no existe o es deficiente.';
    } else if (hits.length) {
      status = 'parcial';
      rationale = neg.length
        ? 'Hay menciones positivas y negativas: implementación incompleta.'
        : 'Hay mención positiva, pero el modo demo no puede verificar el alcance completo.';
    }
    return { id: s.id, status, rationale, evidence: [...neg, ...pos].slice(0, 2).map(quote) };
  });

  const all = documents.map((d) => d.text).join('\n');
  const name = all.match(/(?:empresa|raz[oó]n social|compañ[ií]a)\s*[:\-]\s*([^\n,]{2,60})/i);
  const sector = all.match(/sector\s*[:\-]\s*([^\n.]{2,80})/i);
  return {
    company: { name: name ? name[1].trim() : '', sector: sector ? sector[1].trim() : '' },
    safeguards,
  };
}

// Chat sin OpenAI: respuestas armadas a partir del dashboard.
export function heuristicChat(messages, d) {
  const note = '\n\n_Modo sin API key: respuestas limitadas. Configurá OPENAI_API_KEY para conversar de verdad con Cyber Cactus._';
  if (!d) {
    return 'Todavía no tengo pistas. Subí la documentación de la empresa (📎 o panel izquierdo) y presioná **Analizar documentación**.' + note;
  }
  const q = norm(messages[messages.length - 1]?.content || '');
  const top = d.priorities.slice(0, 5);
  if (/control|salvaguarda|aplic|primero|priori|recomend|mejor|implement/.test(q)) {
    if (!top.length) return 'Todas las salvaguardas IG1 están implementadas. Buen trabajo, socio.' + note;
    return (
      'Si fuera vos, empezaría por estas salvaguardas (mayor mejora del índice):\n' +
      top.map((s) => `- **${s.id} · ${s.title}** (${STATUS[s.status].label}): +${fmt(s.gain)} pts`).join('\n') +
      '\n\nMarcalas en la pestaña **Dashboard** y vas a ver cómo cambia el índice.' + note
    );
  }
  if (/evidencia|sin evidencia|documenta/.test(q)) {
    const nd = d.safeguards.filter((s) => s.status === 'sin_evidencia');
    return `Hay **${nd.length}** salvaguardas sin evidencia en la documentación:\n` + nd.slice(0, 12).map((s) => `- ${s.id} · ${s.title}`).join('\n') + (nd.length > 12 ? `\n- …y ${nd.length - 12} más` : '') + note;
  }
  const worst = [...d.controls].sort((a, b) => a.score - b.score).slice(0, 3);
  return (
    `Índice de cumplimiento CIS IG1: **${fmt(d.index)}/100** (${d.label.label}).\n\n` +
    `Controles más débiles:\n` +
    worst.map((c) => `- **${c.id}. ${c.name}**: ${fmt(c.score)}/100`).join('\n') +
    `\n\nPreguntame qué salvaguardas implementar primero o cuáles no tienen evidencia.` + note
  );
}
