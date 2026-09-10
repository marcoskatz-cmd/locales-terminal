# Locales · Terminal de Ómnibus INGECO

Gestión de locales comerciales: mapa en planta, ficha por local (contrato, pagos, mantenimiento, historial), dashboard y alertas.

- **Frontend**: HTML/CSS/JS sin frameworks, en la raíz del repo. Se publica en GitHub Pages con `git push`.
- **Backend**: Google Apps Script + Google Sheets, en `backend/`. Se publica con `clasp`.
- **Diseño**: [docs/2026-09-10-diseno-locales-terminal.md](docs/2026-09-10-diseno-locales-terminal.md).

## Estado actual: modo demostración

`CONFIG.API_URL` en [config.js](config.js) está vacío, así que la app lee `mock/datos.json` y los cambios viven solo en la pestaña. PIN de demo: `1234`. Sirve para validar la interacción antes de conectar datos reales.

## Pasar a producción (una sola vez)

1. **Backend**
   ```bash
   cd backend
   clasp create --type standalone --title "Locales Terminal API"   # o poner un scriptId existente en .clasp.json
   clasp push --force
   ```
   En el editor web: ejecutar `setupApp()` (crea la planilla con datos ficticios, guarda `APP_SHEET_ID` y `APP_PIN=1234`).
   Cambiar el PIN: ejecutar `cambiarPin('xxxx')` o editar la Script Property `APP_PIN`.
   Desplegar como Web App (ejecutar como yo, acceso: cualquiera) y copiar la URL `/exec`.
   Redeploys posteriores: `clasp create-version "desc"` + `clasp update-deployment <deploymentId> -V <n>` (misma URL).
2. **Frontend**: pegar la URL `/exec` en `CONFIG.API_URL` y hacer `git push`. Con eso la app deja de usar el mock.
3. **Datos reales**: en el editor, `borrarDatosMock()`; después cargar `LOCALES` y `CONTRATOS` en la planilla (respetando los desplegables) o completar `backend/Importar.js` con el mapeo de la planilla de cobranzas.
4. **Plano real**: reemplazar `planos/planta-baja.svg` y `planos/planta-alta.svg`. Cada local es un elemento con `id="L-XX"` (igual al `id_local` de la hoja LOCALES) y `class="zona"`. El resto del SVG es decorativo. Si el plano tiene zonas sin local o locales sin zona, la app lo avisa en la consola del navegador.

## Estructura

```
index.html / styles.css / app.js   UI
config.js                          API_URL, plantas, umbrales de alertas  ← único archivo a tocar para conectar
api.js                             capa de datos (modo demo o modo API)
backend/Reglas.js                  reglas de negocio compartidas (las carga la página Y Apps Script)
backend/WebApp.js                  doPost JSON (ContentService), PIN, lock
backend/Datos.js                   lectura/escritura de hojas por encabezado
backend/Meta.js                    diagnóstico de esquema (columnas faltantes/renombradas)
backend/Setup.js                   setupApp(), borrarDatosMock(), cambiarPin()
backend/Importar.js                enganche para importar cobranzas de planillas existentes
backend/MockData.js                seed ficticio (generado, se borra en producción)
planos/*.svg                       un plano por planta
mock/datos.json                    datos ficticios del modo demo (generado)
herramientas/generar-mock.py       genera mock/datos.json y backend/MockData.js
```

## Desarrollo local

```bash
python -m http.server 8765
```
y abrir `http://localhost:8765`. No hay build.
