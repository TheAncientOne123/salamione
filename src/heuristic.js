// Motor de respaldo SIN IA (modo demo). Produce las mismas estructuras que el modelo
// (ficha de contexto, evaluación, riesgos, roadmap, propuesta de actualización) y todo pasa
// por el mismo verificador. Es deliberadamente conservador: ante la duda, "no_verificado".
//
// Las palabras clave son una ayuda de búsqueda: los dominios y salvaguardas vienen del catálogo.

import { pct, STATUS, SEVERITY } from '../public/scoring.js';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const NEGATION = /\b(no|sin|nunca|carece|carecemos|falta|faltan|pendiente|desactualizad[oa]s?|vencid[oa]s?|inexistente|ningun[oa]?|tampoco|deficiente|insuficiente|improvis\w*)\b/;
// Señales de implementación completa (solo se usan al procesar nueva evidencia).
const STRONG = /\b(100 ?%|todos los|todas las|la totalidad|en todos|en todas|completad[oa]|automatizad[oa]s?)\b/;
const PARTIAL = /\b(parcial\w*|piloto|en curso|en proceso|algunos|algunas|\d{1,2} ?%|primera etapa|fase 1|pendiente)\b/;

// re: frases relacionadas con la salvaguarda · bad: mala práctica explícita · na: exclusión justificada
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
  '10.3': { re: /autoejecucion|autorun|autoplay|pendrives?|medios removibles/, na: /no (se )?(usan|utilizan|permiten) (medios removibles|pendrives|usb)|puertos usb (estan )?(deshabilitados|bloqueados)/ },
  '11.1': { re: /recuperacion (de datos|ante desastres)|plan de recuperacion|proceso de recuperacion/ },
  '11.2': { re: /backups?|copias? de seguridad|respaldos?/ },
  '11.3': { re: /(backups?|respaldos?|copias?) cifrad|proteccion de (los )?respaldos/ },
  '11.4': { re: /fuera de sitio|offline|disco externo|copia aislada|inmutable/ },
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
  // IG2 / IG3 (solo se usan si la evaluación tiene ese alcance)
  '1.3': { re: /descubrimiento (activo|de red)|escaneo de (la )?red|nmap/ },
  '2.5': { re: /lista (blanca|de permitidos)|applocker|allowlist/ },
  '3.10': { re: /cifrad[oa] en transito|\btls\b|\bhttps\b/ },
  '3.11': { re: /cifrad[oa] en reposo|bases? de datos cifrad/ },
  '5.6': { re: /directorio activo|active directory|\bentra id\b|azure ad|ldap/ },
  '6.7': { re: /inicio de sesion unico|\bsso\b|single sign/ },
  '7.5': { re: /escaneo de vulnerabilidades|escaneos? (internos|trimestrales)|nessus|qualys|openvas/ },
  '8.9': { re: /\bsiem\b|centraliza\w* (de )?(los )?(logs|registros)/ },
  '8.11': { re: /revision de (los )?(logs|registros)/ },
  '9.5': { re: /\bdmarc\b|\bdkim\b|\bspf\b/ },
  '10.7': { re: /\bedr\b|\bxdr\b|comportamiento/ },
  '11.5': { re: /prueba de (restauracion|recuperacion)|restauraciones? de prueba/ },
  '12.2': { re: /segmentacion|vlans?|segmentad/ },
  '12.4': { re: /diagrama de (red|arquitectura)/ },
  '13.1': { re: /\bsiem\b|alertas? centralizad|\bsoc\b/ },
  '13.3': { re: /\bids\b|deteccion de intrusiones/ },
  '14.9': { re: /capacitacion (especifica|por rol)/ },
  '15.4': { re: /contratos? [^.]*(seguridad|confidencialidad)/ },
  '16.1': { re: /desarrollo seguro|ciclo de vida de desarrollo|\bsdlc\b/ },
  '16.8': { re: /(entornos?|ambientes?) (de )?(produccion|prueba|desarrollo) separad|separacion de (entornos|ambientes)/ },
  '17.4': { re: /plan de respuesta a incidentes/ },
  '17.7': { re: /simulacro|ejercicio de (respuesta|incidentes)|tabletop/ },
  '18.1': { re: /pruebas? de penetracion|pentest|ethical hacking/ },
  '18.2': { re: /pentest externo|pruebas? de penetracion extern/ },
};

// Un renglón es encabezado si viene marcado con # o si es corto y no termina en puntuación
// (en los PDF los títulos llegan como renglones sueltos).
const isHeading = (l) => /^#{1,6}\s/.test(l) || (l.length < 80 && l.split(/\s+/).length <= 9 && !/[.;:!?,]$/.test(l) && /^[A-ZÁÉÍÓÚÑ0-9]/.test(l));

/** Divide un documento en bloques {heading, paragraphs}; une los renglones cortados de los PDF. */
export function blocks(text) {
  const out = [{ heading: null, paragraphs: [] }];
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.at(-1).paragraphs.push(buf.trim());
    buf = '';
  };
  for (const raw of text.replace(/\[\[Página \d+\]\]/g, '\n').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) {
      flush();
      continue;
    }
    if (isHeading(l) && !buf) {
      out.push({ heading: l.replace(/^#+\s*/, ''), paragraphs: [] });
      continue;
    }
    buf += (buf ? ' ' : '') + l;
    if (/[.!?;:]$/.test(l)) flush();
  }
  flush();
  return out;
}

function sentences(documents) {
  const out = [];
  for (const d of documents) {
    for (const b of blocks(d.text)) {
      for (const p of b.paragraphs) {
        for (const s of p.split(/(?<=[.!?;])\s+/)) {
          const t = s.trim();
          if (t.length > 8) out.push({ doc: d.name, text: t, n: norm(t), heading: b.heading });
        }
      }
    }
  }
  return out;
}

const quote = (s) => ({ document: s.doc, quote: s.text.length > 300 ? s.text.slice(0, 300) : s.text });

/** Clasifica una salvaguarda con las frases encontradas. */
function classify(id, sents, { evidenceMode = false } = {}) {
  const k = KEYWORDS[id];
  if (!k) return null;
  const hits = sents.filter((x) => k.re.test(x.n) || (k.na && k.na.test(x.n)));
  if (!hits.length) return null;
  const naHit = k.na && hits.find((x) => k.na.test(x.n));
  if (naHit) return { status: 'no_aplicable', rationale: 'El documento justifica explícitamente la exclusión.', evidence: [quote(naHit)] };
  const neg = hits.filter((x) => NEGATION.test(x.n) || (k.bad && k.bad.test(x.n)));
  const pos = hits.filter((x) => !neg.includes(x));
  if (neg.length && !pos.length) return { status: 'no_implementado', rationale: 'La documentación indica que no existe o que se hace lo contrario.', evidence: neg.slice(0, 2).map(quote) };
  if (evidenceMode && pos.length && !neg.length && pos.some((x) => STRONG.test(x.n)) && !pos.some((x) => PARTIAL.test(x.n))) {
    return { status: 'implementado', rationale: 'La nueva evidencia describe una implementación completa (alcance total).', evidence: pos.slice(0, 2).map(quote) };
  }
  return {
    status: 'parcial',
    rationale: neg.length
      ? 'Hay menciones positivas y negativas: implementación incompleta.'
      : 'Hay evidencia de que existe, pero no de su alcance completo (R4: usar una tecnología no implica cumplir la salvaguarda).',
    evidence: [...neg, ...pos].slice(0, 2).map(quote),
  };
}

// ---------- Etapa 2: ficha de contexto ----------

const CONTEXT_KEYWORDS = {
  organizacion: /\b(empresa|sector|empleados|sucursal(es)?|depositos?|oficinas?|ubicad\w*|razon social)\b/,
  procesos: /\b(procesos?|servicios?|facturacion|facturar|ventas?|logistica|cadena de frio|distribucion)\b/,
  infraestructura: /\b(servidor(es)?|nube|cloud|on-?premise|hosting|centro de datos|vpn|google workspace|microsoft 365|aws|azure|erp)\b/,
  activos: /\b(equipos|pcs?|notebooks?|servidor(es)?|aplicacion(es)?|base de (datos|clientes)|datos personales|planillas?)\b/,
  identidades: /\b(usuarios?|contrasenas?|accesos?|privilegios?|administrador|doble factor|mfa)\b/,
  proteccion: /\b(antivirus|edr|parches?|hardening|firewall)\b/,
  recuperacion: /\b(backups?|respaldos?|copias? de seguridad|continuidad|recuperacion)\b/,
  monitoreo: /\b(logs?|registros? de|alertas?|monitoreo|incidentes?|ransomware)\b/,
  gobierno: /\b(responsable|politica|proveedor(es)?|terceros|auditor\w*|jefe|gerencia|directorio)\b/,
};

export function heuristicContext(documents) {
  const sents = sentences(documents);
  const used = new Set();
  const dimensions = Object.entries(CONTEXT_KEYWORDS).map(([id, re]) => {
    const hits = sents.filter((s) => re.test(s.n) && !used.has(s.text)).slice(0, 4);
    hits.forEach((h) => used.add(h.text));
    return { id, findings: hits.map((h) => ({ statement: h.text, evidence: [quote(h)] })), missing: [] };
  });
  dimensions.push({
    id: 'restricciones',
    findings: [],
    missing: [
      'Modo demo: la ficha se arma con frases textuales del documento, sin interpretación.',
      ...dimensions.filter((d) => !d.findings.length).map((d) => `Sin información sobre ${d.id}.`),
    ],
  });
  return { dimensions };
}

// ---------- Etapa 3: evaluación ----------

/** Devuelve la misma forma que el modelo: { company, safeguards: [...] } */
export function heuristicAnalysis(documents, catalog) {
  const sents = sentences(documents);
  const safeguards = catalog.safeguards.map((s) => {
    const r = classify(s.id, sents);
    if (!r) {
      return {
        id: s.id,
        applicability: 'por_determinar',
        status: 'no_verificado',
        rationale: 'La documentación no menciona esta salvaguarda.',
        observations: 'Información pendiente para determinar su estado.',
        evidence: [],
      };
    }
    return {
      id: s.id,
      applicability: r.status === 'no_aplicable' ? 'no_aplica' : 'aplica',
      status: r.status,
      rationale: r.rationale,
      observations: r.status === 'parcial' ? 'Falta evidencia del alcance y la frecuencia exigidos por la salvaguarda.' : r.status === 'no_implementado' ? 'Brecha confirmada por el documento.' : '',
      evidence: r.evidence,
    };
  });
  const all = documents.map((d) => d.text).join('\n');
  const name = all.match(/(?:empresa|raz[oó]n social|compañ[ií]a)\s*[:\-]\s*([^\n,]{2,60})/i);
  const sector = all.match(/sector\s*[:\-]\s*([^\n.]{2,80})/i);
  return { company: { name: name ? name[1].trim() : '', sector: sector ? sector[1].trim() : '' }, safeguards };
}

// ---------- Etapa 4: riesgos y roadmap ----------

// Plantillas genéricas por control CIS (solo modo demo). La deficiencia y la justificación salen de la matriz.
const TEMPLATES = {
  1: ['Activos desconocidos o no gestionados', 'Endpoints, servidores y dispositivos de red', 'Equipos sin control que pueden comprometerse sin ser detectados', 'Inventario de activos y gestión de no autorizados'],
  2: ['Software sin soporte o no autorizado', 'Sistemas operativos y aplicaciones de negocio', 'Explotación de vulnerabilidades que el fabricante ya no corrige', 'Inventario de software y plan de reemplazo de sistemas sin soporte'],
  3: ['Exposición o pérdida de datos sensibles', 'Datos de clientes y del negocio', 'Filtración de información y sanciones regulatorias', 'Programa de gestión y protección de datos'],
  4: ['Configuraciones inseguras', 'Servidores, endpoints y red', 'Accesos indebidos por configuraciones por defecto', 'Estándar de configuración segura (hardening)'],
  5: ['Cuentas comprometidas o abusadas', 'Cuentas de usuario y de administrador', 'Uso indebido de credenciales y escalamiento de privilegios', 'Cuentas nominales, bajas de inactivas y separación de administradores'],
  6: ['Accesos no autorizados', 'Aplicaciones expuestas, acceso remoto y administración', 'Intrusión con credenciales robadas', 'MFA y procesos de alta y baja de accesos'],
  7: ['Vulnerabilidades sin remediar', 'Sistemas operativos y aplicaciones', 'Explotación de vulnerabilidades conocidas', 'Gestión automatizada de parches'],
  8: ['Falta de trazabilidad de eventos', 'Registros de sistemas críticos', 'Incidentes no detectados ni investigables', 'Recolección y retención de registros de auditoría'],
  9: ['Ataques por correo y navegación', 'Correo y navegadores', 'Phishing y descarga de malware', 'Navegadores con soporte y filtrado DNS'],
  10: ['Infección por malware', 'Endpoints y servidores', 'Cifrado de información (ransomware) o robo de datos', 'Antimalware en todos los activos con firmas automáticas'],
  11: ['Pérdida de datos sin capacidad de recuperación', 'Información crítica y respaldos', 'Interrupción prolongada y pérdida irreversible de información', 'Respaldos automatizados con copia aislada'],
  12: ['Infraestructura de red vulnerable', 'Equipos de red', 'Compromiso de la red interna', 'Actualización de la infraestructura de red'],
  14: ['Errores humanos e ingeniería social', 'Personal de la organización', 'Phishing exitoso y manejo inseguro de datos', 'Programa de concienciación en seguridad'],
  15: ['Riesgo de proveedores no gestionado', 'Proveedores de servicios', 'Incidentes originados en terceros', 'Inventario y clasificación de proveedores'],
  13: ['Ataques en la red sin detección', 'Red interna y perímetro', 'Intrusiones que avanzan sin alertas', 'Monitoreo centralizado y detección de intrusiones'],
  16: ['Vulnerabilidades en el software propio', 'Aplicaciones desarrolladas o adaptadas', 'Explotación de fallas de código y filtración de datos', 'Proceso de desarrollo seguro'],
  18: ['Defensas no validadas', 'Perímetro y aplicaciones críticas', 'Brechas desconocidas explotables por atacantes', 'Programa de pruebas de penetración'],
  17: ['Respuesta improvisada ante incidentes', 'Procesos críticos del negocio', 'Mayor impacto y tiempo de recuperación ante incidentes', 'Responsables y procedimiento de respuesta a incidentes'],
};

export function heuristicRoadmap(assessments, catalog) {
  const ranked = catalog.controls
    .map((c) => {
      const no = c.safeguards.filter((id) => assessments[id]?.status === 'no_implementado');
      const par = c.safeguards.filter((id) => assessments[id]?.status === 'parcial');
      return { c, no, par, score: no.length * 2 + par.length };
    })
    .filter((x) => x.no.length && TEMPLATES[x.c.id])
    .sort((a, b) => b.score - a.score || b.no.length - a.no.length)
    .slice(0, 5);

  const risks = ranked.map((x, k) => {
    const [title, asset, consequence] = TEMPLATES[x.c.id];
    const sg = [...x.no, ...x.par];
    return {
      id: `R${k + 1}`,
      title,
      description: `Brechas en el control ${x.c.id}. ${x.c.name}.`,
      asset,
      deficiency: `No implementadas: ${x.no.join(', ')}${x.par.length ? `; parciales: ${x.par.join(', ')}` : ''}.`,
      consequence,
      severity: x.no.length >= 2 ? 'alta' : x.par.length ? 'media' : 'media',
      justification: `${x.no.length} de ${x.c.safeguards.length} salvaguardas del control están confirmadas como no implementadas por el documento.`,
      safeguards: sg,
    };
  });
  const initiatives = ranked.map((x, k) => {
    const sg = [...x.no, ...x.par];
    const effort = sg.length <= 1 ? 'bajo' : sg.length <= 3 ? 'medio' : 'alto';
    return {
      id: `I${k + 1}`,
      name: TEMPLATES[x.c.id][3],
      description: `Cerrar las brechas de ${sg.join(', ')} (${x.c.name}).`,
      risks: [`R${k + 1}`],
      safeguards: sg,
      benefit: `Reduce el riesgo "${TEMPLATES[x.c.id][0]}".`,
      effort,
      type: effort === 'alto' ? 'proyecto' : 'quick_win',
      priority: k + 1,
    };
  });
  return { risks, initiatives };
}

// ---------- Etapa 5: nueva evidencia ----------

export function heuristicProposal(newDocs, assessments, catalog) {
  const sents = sentences(newDocs);
  const changes = [];
  for (const s of catalog.safeguards) {
    const r = classify(s.id, sents, { evidenceMode: true });
    if (!r || r.status === assessments[s.id]?.status) continue;
    changes.push({ id: s.id, proposed: r.status, justification: r.rationale, pending: r.status === 'parcial' ? 'Falta evidencia de cobertura total.' : '', evidence: r.evidence });
  }
  // Iniciativas: bloques cuyo encabezado empieza con "Iniciativa".
  const initiatives = [];
  for (const d of newDocs) {
    for (const b of blocks(d.text).filter((x) => x.heading && /^Iniciativa\b/i.test(x.heading))) {
      const body = sentences([{ name: d.name, text: b.paragraphs.join('\n\n') }]);
      const inBlock = (q) => b.paragraphs.some((p) => norm(p).includes(norm(q)));
      const related = changes.filter((c) => c.evidence.some((e) => inBlock(e.quote))).map((c) => c.id);
      const pend = body.filter((x) => /pendiente|falta|aun no|proxim|queda/.test(x.n));
      initiatives.push({
        name: b.heading.slice(0, 120),
        improved: body[0]?.text || '',
        safeguards: related,
        evidence: body.slice(0, 1).map(quote),
        completeness: pend.length || body.some((x) => PARTIAL.test(x.n)) ? 'parcial' : 'completa',
        pending: pend.map((x) => x.text).join(' ').slice(0, 300),
      });
    }
  }
  return { changes, initiatives };
}

// ---------- Chat sin IA ----------

export function heuristicChat(messages, d, catalog) {
  const note = '\n\n_Modo demo (sin IA conectada): respuestas armadas con los datos del dashboard. Conecta tu modelo en Configuración de IA para conversar libremente._';
  const q = norm(messages[messages.length - 1]?.content || '');
  if (/objetivo|criterio|metodolog|alcance|que (vas a|haces|harias)|como (evaluas|trabajas)|informacion suficiente/.test(q)) {
    return (
      `**Objetivo:** evaluar las ${catalog.safeguards.length} salvaguardas de ${catalog.shortName}, identificar brechas y riesgos y proponer cinco iniciativas, usando solo la documentación cargada.\n\n` +
      `**Qué evalúo:** las salvaguardas de los controles ${catalog.controls.map((c) => c.id).join(', ')}. ${catalog.scope}\n\n` +
      '**Criterios:**\n' +
      '- Implementado: una cita del documento muestra que se cumple en lo esencial.\n' +
      '- Parcialmente implementado: existe pero con alcance, frecuencia o formalidad incompletos.\n' +
      '- No implementado: una cita confirma que no existe o que se hace lo contrario.\n' +
      '- No aplicable: el documento justifica la exclusión.\n' +
      '- No verificado: no hay información suficiente.\n\n' +
      '**Sin información suficiente:** marco la salvaguarda como "No verificado", la dejo fuera del indicador de implementación (baja la cobertura) y la registro como información pendiente. Nunca la cuento como incumplimiento.' +
      note
    );
  }
  if (!d) return 'Todavía no hay una evaluación. Adjunta la documentación de la organización con 📎, o describe tu organización en un mensaje y usa **Generar dashboard con esta descripción**.' + note;
  const top = d.priorities.slice(0, 5);
  if (/riesgo/.test(q) && d.risks.length) {
    return 'Los cinco riesgos principales:\n' + d.risks.map((r) => `- **${r.id} · ${r.title}** (severidad ${SEVERITY[r.severity]}): ${r.deficiency}`).join('\n') + note;
  }
  if (/iniciativa|roadmap|control|salvaguarda|aplic|primero|priori|recomend|implement/.test(q) && !/no verificad|evidencia/.test(q)) {
    if (d.initiatives.length) {
      return 'Roadmap propuesto:\n' + d.initiatives.map((i) => `- **${i.id} · ${i.name}** (${i.type === 'quick_win' ? 'quick win' : 'proyecto'}, esfuerzo ${i.effort}): ${i.safeguards.join(', ')}`).join('\n') + note;
    }
    return 'Primero abordaría estas brechas confirmadas:\n' + top.map((s) => `- **${s.id} · ${s.title}** (${STATUS[s.status].label})`).join('\n') + note;
  }
  if (/evidencia|verificad|falta|informacion/.test(q)) {
    const nd = d.safeguards.filter((s) => s.status === 'no_verificado');
    return `Hay **${nd.length}** salvaguardas no verificadas (sin información suficiente):\n` + nd.slice(0, 12).map((s) => `- ${s.id} · ${s.title}`).join('\n') + (nd.length > 12 ? `\n- …y ${nd.length - 12} más` : '') + note;
  }
  return (
    `**Implementación:** ${pct(d.implementation)} sobre ${d.evaluable} salvaguardas evaluables · **Cobertura:** ${pct(d.coverage)}.\n\n` +
    `- ${d.counts.implementado} implementadas, ${d.counts.parcial} parciales, ${d.counts.no_implementado} no implementadas\n` +
    `- ${d.counts.no_verificado} no verificadas y ${d.counts.no_aplicable} no aplicables\n\n` +
    'Pregúntame por los riesgos, el roadmap o las salvaguardas no verificadas.' +
    note
  );
}
