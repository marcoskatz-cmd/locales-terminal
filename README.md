# Locales · Terminal de Ómnibus INGECO

Gestión de locales comerciales: mapa en planta con zoom por sector, ficha por local (contrato, pagos, mantenimiento, historial), dashboard y alertas.

- **Frontend**: HTML/CSS/JS sin frameworks, en la raíz del repo. Se publica en GitHub Pages con `git push`.
- **Backend**: Google Apps Script + Google Sheets, en `backend/`. Se publica con `clasp`.
- **Diseño**: [docs/2026-09-10-diseno-locales-terminal.md](docs/2026-09-10-diseno-locales-terminal.md).

## Estado actual

- **Plano real** (CONFORME A OBRA 2026, planta baja, sectores Block 1..8): 147 zonas detectadas automáticamente.
- **Unidades reales** (sep-2026): ~200, tomadas de la planilla "Alquileres Terminal" (boleterías, locales, depósitos, góndolas del hall, oficinas de planta alta, encomiendas, predio norte), con superficie, rubro, precio acordado y notas. No todas están en el plano: góndolas, oficinas y predio aparecen solo en la lista.
- **Cobranzas mayo–agosto 2026** cargadas como cuotas (total del mes, "todo concepto") y pagos (transferencia / efectivo / cheque / retención, con fecha). La deuda que muestra la app sale de ahí.
- Lo que falta de los contratos (fechas de inicio y fin, CUIT, depósito, índice) no está en ninguna fuente: la app los marca "Contrato incompleto" hasta que se completen en la planilla.
- `CONFIG.API_URL` en [config.js](config.js) está vacío: la app corre en modo demostración (lee `mock/datos.json`, PIN `1234`).

## Flujo de datos

```
CONFORME A OBRA 2026.pdf                                   Alquileres Terminal.xlsx + COBRANZAS mayo-Agosto.xlsx
   │  herramientas/extraer-plano.py <pdf> [--debug]                     │
   ▼                                                                    │
planos/planta-baja.png + .svg + herramientas/plano-locales.json ────────┤
                                                                        │  herramientas/importar-alquileres.py <alquileres> <cobranzas>
                                                                        ▼
docs/Relevamiento locales Terminal.xlsx   ←── administración revisa REVISAR y completa LOCALES / CONTRATOS
   │  herramientas/generar-datos.py                  (avisa si falta una columna o hay incoherencias)
   ▼
mock/datos.json (modo demo)  +  backend/MockData.js (semilla de setupApp)
```

- `importar-alquileres.py` **pisa** la planilla de relevamiento: correrlo solo cuando lleguen planillas fuente nuevas. Las hojas CRUCE y REVISAR explican cada emparejamiento (zona ↔ unidad, cobranza ↔ unidad) y qué quedó dudoso.
- Cada vez que se corrige la planilla a mano, correr `python herramientas/generar-datos.py` y pushear.
- Ids de unidad: categoría + número (`BOL-1-2`, `LOC-501`, `GON-3`, `OFI-7`, `DEP-305`, `ENC-512`, `COB-…` para las que solo aparecen en cobranzas). El número solo no alcanza: hay un 9 boletería, un 9 local y un 9 góndola.
- Una unidad puede ocupar varias zonas del plano (`zonas_plano = L-41A;L-41B`) o ninguna.

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
docs/Relevamiento locales Terminal.xlsx   planilla que revisa y completa administración (LOCALES, CONTRATOS, CUOTAS, PAGOS, CRUCE, REVISAR)
herramientas/                      extraer-plano.py · importar-alquileres.py · generar-datos.py · plano-locales.json
```

## Desarrollo local

```bash
python -m http.server 8765
```
y abrir `http://localhost:8765`. No hay build.
