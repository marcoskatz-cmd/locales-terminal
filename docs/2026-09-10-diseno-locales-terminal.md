# Gestión de locales · Terminal INGECO — Diseño v1

Fecha: 2026-09-10. Confirmado por Marcos Katz en la misma sesión.

## Decisiones fijadas

| Tema | Decisión |
|---|---|
| Stack | Google Apps Script + Google Sheets (una hoja por entidad). Frontend estático en GitHub Pages que habla con Apps Script por `fetch()` a un `doPost` que devuelve JSON (ContentService). No se usa HtmlService para la UI por el bug de ruteo `/u/N` con multi-login. |
| Volumen | ~60 locales en 2 plantas (PB y PA). ~1.500 cuotas/año. 1 a 3 usuarios. Sheets alcanza. |
| Acceso | **PIN único** validado en el servidor en cada request (Script Property `APP_PIN`). Sin PIN válido la API no devuelve nada. Upgrade previsto: PIN por persona → llena `usuario` en `HISTORIAL`. |
| Moneda | Solo pesos. Sin columna de moneda. |
| Mantenimiento | Lo carga administración desde la misma app (v1). Si después lo carga un encargado desde el celular, se hace una vista de carga aparte. |
| Cobranzas | Existe planilla pero sin acceso aún. Queda `backend/Importar.js` como punto de enganche con diagnóstico de columnas. |
| Plano | Mock generado (SVG por planta). El real se traza después manteniendo los `id` de zona = `id_local`. |
| Repo | Público en `marcoskatz-cmd/locales-terminal`. Deploy frontend por `git push`, backend por `clasp`. |

## Modelo de datos (hojas)

- `LOCALES`: id_local, nombre, planta, sector, m2, rubro, estado (LIBRE/ALQUILADO/REFACCION), observaciones, activo.
- `CONTRATOS`: id_contrato, id_local, inquilino, cuit, contacto, fecha_inicio, fecha_fin, monto_alquiler, indice_ajuste, periodicidad_meses, proxima_fecha_ajuste, deposito, expensas_mensuales, estado_contrato (VIGENTE/FINALIZADO/RESCINDIDO), observaciones.
- `CUOTAS`: id_cuota, id_contrato, id_local, periodo (AAAA-MM), concepto (ALQUILER/EXPENSAS), monto, vencimiento, estado (PENDIENTE/PARCIAL/PAGADA).
- `PAGOS`: id_pago, id_cuota, id_local, fecha, monto, medio, comprobante, observaciones.
- `MANTENIMIENTO`: id_mant, id_local (o COMUN), planta, fecha_reporte, tipo_falla, descripcion, prioridad, estado (PENDIENTE/EN CURSO/RESUELTO), quien_intervino, fecha_resolucion, costo, fotos, observaciones.
- `HISTORIAL`: fecha, usuario, entidad, id, campo, valor_anterior, valor_nuevo.
- `LISTAS`: una columna por selector (rubros, índices, tipos de falla, intervinientes, medios de pago, sectores).
- `META`: versión del esquema. El backend compara los encabezados reales contra `ESQUEMA` en `Config.js` y devuelve `diagnostico`; el frontend lo muestra como banner.

Todas las fechas se guardan como texto `AAAA-MM-DD` para evitar los problemas de zona horaria de las celdas Date.

## Estado visual (calculado, nunca cargado)

- `REFACCION` → refacción (azul rayado).
- `LIBRE` → libre (gris).
- `ALQUILADO` sin cuotas vencidas impagas → al día (teal).
- `ALQUILADO` con alguna cuota con `vencimiento < hoy` y estado ≠ PAGADA → con deuda (naranja).
- Ícono de llave superpuesto si hay mantenimiento con estado ≠ RESUELTO (independiente del color).

Colores elegidos para visión rojo-verde: sin rojo ni verde puro, siempre con etiqueta de texto al lado.

## Reglas POKAYOKE

- Todo campo con universo conocido es un `<select>` alimentado desde `LISTAS`.
- No se puede poner un local en LIBRE si tiene contrato VIGENTE; no se puede poner ALQUILADO sin contrato vigente (primero se carga el contrato, y eso pone el local en ALQUILADO solo).
- Registrar pago: solo se eligen cuotas PENDIENTE o PARCIAL; el monto viene precargado con el saldo.
- Generar cuotas del mes: crea ALQUILER + EXPENSAS solo para los contratos vigentes que todavía no las tienen para ese período (idempotente).
- Falla RESUELTA exige `quien_intervino`; la fecha de resolución se completa sola.

## v1 / v2

- **v1**: mapa multi-planta, ficha (resumen, contrato, pagos, mantenimiento, historial), dashboard, buscador y filtros, alertas (vencimiento 30/60/90, ajuste ≤30 días, mora, fallas ALTA), historial de cambios, ayuda integrada, diagnóstico de esquema.
- **v2**: fotos en fallas, generación automática mensual de cuotas por trigger, avisos por mail, exportar PDF, importación de cobranzas desde la planilla existente, PIN por persona.

## Puntos de reemplazo

1. `planos/planta-baja.svg` y `planos/planta-alta.svg` → plano real, un elemento con `id="L-XX"` por local.
2. `mock/datos.json` → se deja de usar al setear `CONFIG.API_URL` en `config.js`.
3. `backend/MockData.js` → se borra junto con `setupApp()` una vez cargados los datos reales (o se corre `borrarDatosMock()`).
4. `backend/Importar.js` → mapeo de columnas de la planilla de cobranzas.
