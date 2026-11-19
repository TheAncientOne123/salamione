# Cyber Cactus 🌵🕵️

Agente de ChatGPT, un detective de riesgo corporativo con gabardina, fedora y lentes oscuros, con una página propia que tiene dos vistas:

- **Chat**: la vista principal y el único lugar donde se cargan documentos. Con 📎 subís archivos o pegás texto, y también podés arrastrarlos al chat. Al subir un documento, Cyber Cactus lo analiza automáticamente mientras se muestra un círculo de carga en el centro de la pantalla. Los documentos cargados aparecen como etiquetas sobre la barra de escritura. El agente también **actúa**: si le decís *"ya implementamos MFA para la VPN"*, marca la salvaguarda y el dashboard se actualiza.
- **Dashboard**: el índice de cumplimiento, una tarjeta por cada control del catálogo y las salvaguardas, que también se pueden marcar a mano.
- **Versiones**: cada análisis guarda una versión automáticamente, y después de aplicar controles podés guardar otra (botón *Guardar versión* del dashboard, la pestaña Versiones o pidiéndoselo al chat). En la pestaña **Versiones** se comparan dos versiones, o una versión con el estado actual: índice A → B, conteos por estado, variación por control y la lista de salvaguardas que mejoraron o retrocedieron (marcando cuáles se aplicaron a mano). Cualquier versión se puede **restaurar**: vuelve el diagnóstico y los controles aplicados, pero no los documentos.
- **Selector de modelo** en la barra superior: elegís qué modelo de ChatGPT usa el agente. La elección queda guardada.

Qué hace:

1. **Recibe la fuente de verdad** de la organización: políticas, informes, inventarios o procedimientos, en PDF, DOCX, TXT, MD, CSV, JSON, HTML o como texto pegado.
2. **La evalúa contra el catálogo [`Catalogo_CIS_v8.1_IG1.md`](Catalogo_CIS_v8.1_IG1.md)**: 15 controles CIS y 56 salvaguardas IG1. Los dominios del dashboard salen **solo** de ese archivo; si se edita, el sistema se adapta al reiniciar.
3. **Califica cada salvaguarda**: Implementado, Parcial, No implementado o Sin evidencia, siempre con citas textuales de los documentos.
4. **Muestra un dashboard**: índice de cumplimiento de 0 a 100, puntaje y peso por control, mapa de las 56 salvaguardas, prioridades y detalle con evidencia.
5. **Recalcula al aplicar controles**: cada salvaguarda se marca como aplicada (desde el dashboard o pidiéndoselo al chat) y el índice cambia al instante. El estado documentado se conserva para comparar.
6. **Exporta un PDF ejecutivo** a partir de una **plantilla fija del dashboard** ([`templates/reporte.html`](templates/reporte.html) + [`templates/reporte.css`](templates/reporte.css)). Las tarjetas son las mismas que en la página ([`public/components.js`](public/components.js)). El PDF lo imprime el navegador instalado (Edge o Chrome) mediante `puppeteer-core`. Para ver la plantilla completa sin generar el PDF: `GET /api/report.html`.
7. **Chat con herramientas**: `analizar_documentacion`, `actualizar_salvaguarda` (solo acepta IDs del catálogo) y `guardar_version`.

### Cómo evita inventar

| Capa | Qué hace |
|---|---|
| Esquema de respuesta | Los IDs de salvaguarda, los estados y los nombres de documento son listas cerradas (`enum`) dentro del JSON Schema estricto de OpenAI. |
| Prompt | Solo se puede calificar con una cita textual; ante la duda, "Sin evidencia". Se ignoran las instrucciones que vengan dentro de los documentos. |
| Verificador ([`src/verify.js`](src/verify.js)) | Cada cita se busca en el texto real del documento. Las que no aparecen se descartan, y un estado sin cita verificada se degrada a "Sin evidencia". Se descartan los IDs que no están en el catálogo. El nombre y el sector de la organización solo se aceptan si figuran textualmente. |
| Resumen ejecutivo | Se arma con plantillas a partir de los números calculados; no lo redacta el modelo. |

### Valoración

En [`config/valoracion.json`](config/valoracion.json) se configuran:
- `valoresEstado`: puntaje de cada estado. Por defecto Implementado 100, Parcial 50, No implementado 0 y Sin evidencia 0.
- `pesosControl`: peso de cada control CIS en el índice. Por defecto es la cantidad de salvaguardas del control, de modo que las 56 valen lo mismo.

El puntaje de un control es el promedio de sus salvaguardas, y el índice es el promedio de los controles ponderado por su peso. Junto a cada salvaguarda pendiente se muestra cuántos puntos sumaría al índice si se implementa.

Si OpenAI no responde (cuenta sin saldo, key inválida, modelo no disponible o sin red), Cyber Cactus pasa solo al **modo demo** y avisa en pantalla qué pasó.

## Puesta en marcha

```bash
npm install
cp .env.example .env      # completar OPENAI_API_KEY
npm start                 # http://localhost:3000
```

Para probar, adjuntá `samples/empresa-demo.md` desde el chat.

**Modelos:** el selector ofrece `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`, `gpt-5`, `gpt-5-mini` y `gpt-5-nano`, más el de `OPENAI_MODEL`. Para cambiar la lista, usá `OPENAI_MODELS=modelo1,modelo2` en `.env`. Al cambiar de modelo, conviene volver a analizar.

**PDF:** necesita Microsoft Edge o Google Chrome instalado. Si no lo encuentra, indicá la ruta del navegador en `CHROME_PATH`.

Sin `OPENAI_API_KEY`, o si OpenAI no responde, la app funciona en **modo demo**: hace un análisis de brechas por palabras clave y el chat da respuestas básicas armadas con los datos del dashboard. **La API de OpenAI se paga aparte de ChatGPT Plus**: la cuenta necesita saldo en *Settings → Billing*. Con la clave usa ChatGPT (`OPENAI_MODEL`, por defecto `gpt-4.1`) con *Structured Outputs*, de modo que la respuesta del agente siempre respeta el esquema.

## Estructura

| Archivo | Rol |
|---|---|
| `server.js` | API Express: documentos, análisis, controles, chat |
| `src/agent.js` | Prompts, esquemas JSON y herramientas de Cyber Cactus para OpenAI, con respaldo automático |
| `src/catalog.js` | Lee el catálogo CIS del Markdown y la valoración |
| `src/verify.js` | Verificación de citas, IDs y datos de la organización |
| `src/report.js` | Completa la plantilla del PDF y la imprime con el navegador |
| `templates/` | Plantilla fija del PDF ejecutivo (HTML + CSS) |
| `public/components.js` | Tarjetas compartidas por el dashboard y el PDF |
| `public/versions.js` | Resumen de versiones y comparación A/B |
| `src/heuristic.js` | Motor de respaldo sin API key |
| `src/extract.js` | Extracción de texto (PDF, DOCX, etc.) |
| `src/store.js` | Persistencia en `data/state.json` |
| `public/` | La página del agente (HTML, CSS y JS sin framework) y `logo.svg` |
| `config/valoracion.json` | Valores por estado y pesos por control |
| `test/` | Tests del catálogo, el verificador y el puntaje (`npm test`) |

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/state` | Documentos, análisis y dashboard calculado |
| POST | `/api/documents` | Subir archivos (multipart, campo `files`) |
| POST | `/api/documents/text` | `{name, text}` |
| DELETE | `/api/documents/:id` | Quitar un documento |
| POST | `/api/analyze` | Evaluar toda la fuente de verdad contra el catálogo |
| PUT | `/api/safeguards/:id` | `{status: "implementado" \| "parcial" \| "no_implementado" \| "documentado"}` |
| GET | `/api/report.pdf` | Descargar el PDF ejecutivo |
| GET | `/api/report.html` | Vista previa HTML de la plantilla del PDF |
| PUT | `/api/settings` | `{model}`: cambia el modelo de ChatGPT |
| POST | `/api/versions` | `{label}`: guarda una versión del estado actual |
| POST | `/api/versions/:id/restore` | Restaura el diagnóstico y los controles aplicados de una versión |
| DELETE | `/api/versions/:id` | Elimina una versión |
| POST | `/api/chat` | `{messages: [{role, content}]}` → `{reply, actions, state?}` |
| POST | `/api/reset` | Borrar todo |

## Notas

- Al volver a analizar, se conservan las salvaguardas aplicadas, porque sus IDs son estables.
- Los documentos se truncan a `MAX_DOC_CHARS` en total, repartidos entre los documentos.
- Los PDF escaneados sin OCR no tienen texto extraíble.
- Hay un único espacio de trabajo por instalación y no hay autenticación. Antes de exponer la app fuera de `localhost`, hay que agregar login.
