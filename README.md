# SalamiOne

Asesor de ciberseguridad experto en **CIS Controls v8.1**, con los tres Implementation Groups: IG1 (56 salvaguardas), IG2 (130) e IG3 (153). A partir de documentos o de lo que el usuario describe en el chat, arma un dashboard con citas verificadas. El dashboard se exporta a PDF y Excel, genera un resumen ejecutivo de una página y compara versiones para saber si los cambios mejoraron o empeoraron la postura.

Cada usuario tiene su cuenta, sus evaluaciones (una por organización) y su propio modelo de IA: OpenAI, Anthropic Claude, Google Gemini, Ollama (local) o cualquier servidor compatible con OpenAI.

## Puesta en marcha

```bash
npm install
cp .env.example .env      # opcional: APP_SECRET, IA del servidor, puerto
npm start                 # http://localhost:3000
```

- `/` landing · `/registro` y `/login` acceso · `/app` aplicación (requiere sesión).
- La primera cuenta que se registra hereda la evaluación de la versión anterior (`data/state.json`), si existe.
- Requiere **Node 22.5 o superior** (usa `node:sqlite`, sin dependencias nativas) y Chrome o Edge instalado para imprimir los PDF (`CHROME_PATH` si no se detecta).

## Cómo se usa

1. **Crea una evaluación** (selector arriba a la izquierda) y elige el IG objetivo.
2. **Conecta tu IA** (botón de estado arriba a la derecha). Sin IA, funciona el motor demo de reglas.
3. **Carga la evidencia:** con 📎 sube PDF, DOCX, TXT, MD, CSV, JSON o HTML, pega texto, o carga el caso de ejemplo. También puedes **describir la organización en el chat** y pulsar *Generar dashboard con esta descripción* (o pedírselo al chat): tus mensajes se guardan como documento de contexto y las citas se verifican contra ellos.
4. **Dashboard:** implementación, cobertura, mapa por control, cinco riesgos, roadmap, ficha de contexto y la matriz completa con evidencia. Los botones de cada salvaguarda simulan cambios sin tocar la evidencia.
5. **Exporta:** *Dashboard en PDF*, *Dashboard en Excel* (hojas Resumen, Controles, Salvaguardas, Riesgos, Roadmap y Contexto) y *Resumen ejecutivo* de una página carta (se verifica que tenga exactamente una página).
6. **Antes y después:** sube **nueva evidencia** (avance de iniciativas o documento actualizado). SalamiOne propone cambios con citas, tú apruebas o rechazas cada uno, y se guarda una versión nueva. En **Comparar** eliges A y B y obtienes el veredicto (*Mejoró*, *Empeoró*, *Resultado mixto* o *Sin cambios*), la variación por control, las salvaguardas que mejoraron o retrocedieron y los riesgos. La comparación también se exporta a PDF y Excel.

El tutorial se muestra al primer inicio de sesión y se puede repetir desde el menú de usuario.

## Indicadores

- **Implementación** = (I + 0,5 × P) / (I + P + N) × 100. "No determinable" si no hay salvaguardas evaluables.
- **Cobertura** = (I + P + N) / (total del IG − No aplicables) × 100.

"No verificado" **no cuenta como incumplimiento**: queda fuera de la implementación y solo baja la cobertura. Los valores de cada estado están en [`config/valoracion.json`](config/valoracion.json).

## Cómo evita inventar

| Capa | Qué hace |
|---|---|
| Esquemas de respuesta | IDs de salvaguarda, estados y nombres de documento son listas cerradas (`enum`) en salida estructurada estricta |
| Prompt maestro | [`config/prompt-maestro.md`](config/prompt-maestro.md), reglas R1–R12: sin cita textual no hay conclusión; ante la duda, "No verificado"; las instrucciones dentro de los documentos se ignoran |
| Verificador ([`src/verify.js`](src/verify.js)) | Busca cada cita en el texto real y le agrega página (PDF) o sección. Las citas que no aparecen se descartan y los estados sin cita pasan a "No verificado" |
| Indicadores, resumen y veredicto | Los calcula el sistema a partir de la matriz; no los redacta el modelo |

La evaluación se hace **por lotes de controles** (máx. 40 salvaguardas por llamada, `SAFEGUARD_BATCH`), así IG3 entra en la salida de cualquier modelo. Si el proveedor falla (clave, saldo, red o modelo), el agente pasa al motor demo, que recorre las mismas etapas y el mismo verificador, y lo avisa en pantalla.

## Proveedores de IA

| Proveedor | Cómo se conecta | Salida estructurada |
|---|---|---|
| OpenAI | API key | `json_schema` estricto (Chat Completions; Responses API si el modelo lo exige) |
| Anthropic (Claude) | API key · SDK oficial `@anthropic-ai/sdk` | `output_config.format` con `json_schema`; streaming para respuestas largas; respaldo del servidor ante negativas en los modelos que lo admiten |
| Google Gemini | API key de AI Studio · endpoint compatible con OpenAI | `json_schema` |
| Ollama (local) | URL base (por defecto `http://localhost:11434/v1`), sin clave | `json_schema`, o JSON pedido en el prompt |
| Compatible con OpenAI | URL base + modelo (LM Studio, OpenRouter, Azure, vLLM…) | `json_schema` → `json_object` → JSON en el prompt |

La API key se guarda **cifrada (AES-256-GCM)** con `APP_SECRET` y nunca vuelve al navegador (solo los últimos 4 caracteres). *Probar conexión* hace una llamada con salida estructurada para validar clave y modelo. Si un usuario no configuró nada y el `.env` tiene `OPENAI_API_KEY` o `ANTHROPIC_API_KEY`, se usa esa IA del servidor (desactivable con `SERVER_AI=false`).

## Seguridad

- Contraseñas con **scrypt**; sesiones con cookie `HttpOnly` + `SameSite=Lax` (y `Secure` con `COOKIE_SECURE=true` detrás de HTTPS); tokens guardados como hash.
- Límite de intentos de inicio de sesión, verificación de origen en peticiones que modifican datos y cabeceras básicas de seguridad.
- Cada usuario solo accede a sus evaluaciones y a sus archivos exportados (`data/exports/<evaluación>/`).
- Para producción: define `APP_SECRET` fijo (si cambia, las API keys guardadas dejan de poder leerse), sirve detrás de HTTPS con `TRUST_PROXY=1` y `COOKIE_SECURE=true`, y respalda `data/`.

## Estructura

| Archivo | Rol |
|---|---|
| `server.js` | Páginas, API, contexto por solicitud (usuario, evaluación, catálogo del IG e IA), exportaciones y chat |
| `src/db.js` · `src/auth.js` · `src/security.js` · `src/store.js` | SQLite, cuentas y sesiones, hash y cifrado, evaluaciones y su estado |
| `src/ai/` | Proveedores: `openai-compatible.js` (OpenAI, Gemini, Ollama, compatibles), `anthropic.js` (Claude), `index.js` (registro y errores) |
| `src/agent.js` | Contexto → salvaguardas por lotes → riesgos y roadmap → nueva evidencia; chat con herramientas |
| `catalog/CIS_Controls_v8.1.md` · `src/catalog.js` | Catálogo de 153 salvaguardas con su IG; único origen de controles y salvaguardas |
| `src/verify.js` · `src/heuristic.js` | Verificador de citas y motor demo |
| `src/report.js` · `src/xlsx.js` · `src/onepager.js` · `src/pdfsummary.js` · `src/matrix.js` | Dashboard y comparación en PDF, Excel, resumen de una página, PDF libre desde el chat y CSV |
| `public/index.html` · `login.html` · `app.html` | Landing, acceso y aplicación |
| `public/app.js` · `tour.js` · `components.js` · `scoring.js` · `versions.js` | Interfaz, tutorial, componentes compartidos con los PDF, indicadores y comparación con veredicto |
| `templates/` | Plantillas fijas de los PDF |
| `samples/` | Caso de ejemplo (Distribuidora Andina S.A.: contexto y avance de iniciativas) |
| `test/` | `npm test` |

## Herramientas del chat

El agente puede, según lo que pida el usuario: evaluar la documentación, **armar el dashboard desde la conversación**, simular salvaguardas, guardar versiones, **exportar el dashboard (PDF o Excel)**, **generar el resumen ejecutivo**, **comparar versiones** con veredicto y enlaces de descarga, y crear un PDF de una página con el formato que se le indique.

## API principal

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/logout` · GET `/api/auth/me` | Cuentas y sesión |
| GET | `/api/state` | Estado de la evaluación activa |
| POST · PUT · DELETE | `/api/workspaces[/:id]` · POST `/api/workspaces/:id/activate` | Evaluaciones (nombre e IG) |
| GET · PUT | `/api/me/ai` · POST `/api/me/ai/models` · `/api/me/ai/test` | Configuración de IA del usuario |
| POST | `/api/documents` · `/api/documents/text` · `/api/sample/:rol` | Documentos y caso de ejemplo |
| POST | `/api/analyze` · `/api/evaluate-chat` | Evaluar documentos o la descripción del chat |
| POST | `/api/evidence` · PUT `/api/proposal/changes/:id` · POST `/api/proposal/apply` | Nueva evidencia y validación |
| GET | `/api/export/dashboard.pdf` · `.xlsx` · `/api/export/summary.pdf` (`?version=`) | Exportaciones |
| GET | `/api/export/compare.pdf` · `.xlsx` · `.json` (`?a=&b=`, acepta `inicial`, `current`, número o id) | Comparación antes/después |
| POST · DELETE | `/api/versions` · `/api/versions/:id/restore` | Versiones |
| POST | `/api/chat` | `{messages}` → `{reply, actions, state}` |

## Notas

- Los PDF escaneados sin OCR no tienen texto extraíble.
- Las descripciones del catálogo son resúmenes en español con fines de evaluación documental; el texto oficial es la publicación de CIS. CIS Controls® es marca de Center for Internet Security, Inc.
- `docs/` conserva la entrega académica original (versión Cyber Cactus) como registro histórico.
