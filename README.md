# Locales · Terminal de Ómnibus INGECO

Gestión de locales comerciales: mapa en planta con zoom por sector, ficha por local (contrato, pagos, mantenimiento, historial), dashboard y alertas.

- **Frontend**: HTML/CSS/JS sin frameworks, en la raíz del repo. Se publica en GitHub Pages con `git push`.
- **Backend**: Google Apps Script + Google Sheets, en `backend/`. Se publica con `clasp`.
- **Diseño**: [docs/2026-09-10-diseno-locales-terminal.md](docs/2026-09-10-diseno-locales-terminal.md).

## Estado actual

- El **plano real** (CONFORME A OBRA 2026, planta única, 8 sectores "Block 1..8") ya está integrado: 147 locales detectados automáticamente.
- Los datos salen de la **planilla de relevamiento** `docs/Relevamiento locales Terminal.xlsx`, prellenada desde el plano (inquilino que figura en cada local, VACÍO = libre). Falta que administración la complete: m², rubro, fechas y montos de contrato.
- `CONFIG.API_URL` en [config.js](config.js) está vacío: la app corre en modo demostración (lee `mock/datos.json`, PIN `1234`), con los locales reales y contratos marcados como incompletos.

## Flujo de datos

```
CONFORME A OBRA 2026.pdf
   │  herramientas/extraer-plano.py <pdf> [--debug]
   ▼
planos/planta-baja.png + planos/planta-baja.svg + herramientas/plano-locales.json
   │  herramientas/generar-relevamiento.py           (no pisa la planilla si ya existe)
   ▼
docs/Relevamiento locales Terminal.xlsx   ←── administración completa LOCALES / CONTRATOS / MANTENIMIENTO
   │  herramientas/generar-datos.py                  (avisa si falta una columna o hay incoherencias)
   ▼
mock/datos.json (modo demo)  +  backend/MockData.js (semilla de setupApp)
```

Cada vez que se actualiza la planilla, correr `python herramientas/generar-datos.py` y pushear.

## Pasar a producción (una sola vez)

1. **Backend**
   ```bash
   cd backend
   clasp create --type standalone --title "Locales Terminal API"   # o poner un scriptId existente en .clasp.json
   clasp push --force
   ```
   En el editor web: ejecutar `setupApp()` (crea la planilla de Google con los datos del relevamiento, guarda `APP_SHEET_ID` y `APP_PIN=1234`).
   Cambiar el PIN: ejecutar `cambiarPin('xxxx')` o editar la Script Property `APP_PIN`.
   Desplegar como Web App (ejecutar como yo, acceso: cualquiera) y copiar la URL `/exec`.
   Redeploys posteriores: `clasp create-version "desc"` + `clasp update-deployment <deploymentId> -V <n>` (misma URL).
2. **Frontend**: pegar la URL `/exec` en `CONFIG.API_URL` y hacer `git push`. Con eso la app deja de usar `mock/datos.json`.
3. Desde ahí los cambios se hacen en la app (o directo en la planilla de Google, que tiene los mismos desplegables). La planilla Excel queda como carga inicial.

## Ajustar el plano

- Las zonas son `<rect id="L-XX" class="zona">` en `planos/planta-baja.svg`, en puntos del PDF. Si una caja quedó corrida o corta, se edita `x/y/width/height` a mano; solo importa que el `id` coincida con `id_local`.
- Para regenerar desde el PDF: `python herramientas/extraer-plano.py "ruta\CONFORME A OBRA 2026.pdf" --debug` y revisar `herramientas/debug-zonas.png`. Ojo: pisa el SVG (y las correcciones manuales).
- Si un local del plano no aparece en la app o al revés, la consola del navegador lo lista al cargar.
- Los sectores se definen en `extraer-plano.py` (posición de los rótulos BLOCK) y en `CONFIG.SECTORES`; la vista con zoom de cada sector se calcula sola a partir de sus zonas.

## Estructura

```
index.html / styles.css / app.js   UI (mapa con pan/zoom, ficha, alertas, formularios)
config.js                          API_URL, plantas, sectores, umbrales  ← único archivo a tocar para conectar
api.js                             capa de datos (modo demo o modo API)
backend/Reglas.js                  reglas de negocio compartidas (las carga la página Y Apps Script)
backend/WebApp.js                  doPost JSON (ContentService), PIN, lock
backend/Datos.js                   lectura/escritura de hojas por encabezado
backend/Meta.js                    diagnóstico de esquema (columnas faltantes/renombradas)
backend/Setup.js                   setupApp(), borrarDatosMock(), cambiarPin()
backend/Importar.js                enganche para importar cobranzas de planillas existentes
backend/MockData.js                semilla generada desde el relevamiento
planos/planta-baja.png|svg         fondo del plano + zonas clickeables
docs/Relevamiento locales Terminal.xlsx   planilla que completa administración
herramientas/                      extraer-plano.py · generar-relevamiento.py · generar-datos.py · plano-locales.json
```

## Desarrollo local

```bash
python -m http.server 8765
```
y abrir `http://localhost:8765`. No hay build.
