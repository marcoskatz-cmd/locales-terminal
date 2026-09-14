// ============================================================
//  WEBAPP — API JSON. doPost con ContentService (evita el ruteo /u/N de HtmlService).
//  Body: { accion, pin, datos }  ·  Content-Type: text/plain (sin preflight CORS)
//  Respuesta: { ok, ... } o { ok:false, error, codigo }
// ============================================================

function doGet() {
  return responder_({ ok: true, servicio: 'Locales Terminal INGECO', version_esquema: VERSION_ESQUEMA, hora: new Date().toISOString() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = {};
    try { body = JSON.parse(e.postData && e.postData.contents || '{}'); } catch (err) { return responder_({ ok: false, error: 'Cuerpo inválido.' }); }
    var accion = String(body.accion || '');
    var pinOk = validarPin_(body.pin);

    if (accion === 'validarPin') return responder_(pinOk ? { ok: true } : { ok: false, codigo: 'PIN', error: 'PIN incorrecto.' });
    if (!pinOk) return responder_({ ok: false, codigo: 'PIN', error: 'PIN incorrecto.' });

    var ss = abrirPlanilla_();
    var usuario = 'admin'; // con PIN único no hay identidad; al pasar a PIN por persona se resuelve acá

    if (accion === 'cargarTodo') {
      var datos = cargarDatos_(ss);
      return responder_({ ok: true, datos: datos, diagnostico: diagnosticarEsquema_(ss).concat(diagnosticarDatos_(datos)), modo: 'api' });
    }

    if (!REGLAS.ACCIONES[accion]) return responder_({ ok: false, error: 'Acción desconocida: ' + accion });

    // Mutaciones: serializadas con lock para que dos personas no pisen ids
    lock.waitLock(20000);
    var d = cargarDatos_(ss);
    var ahora = new Date();
    var ctx = { usuario: usuario, hoy: REGLAS.hoyISO(ahora), ahora: REGLAS.ahoraISO(ahora) };
    var resultado = REGLAS.ejecutar(accion, d, body.datos || {}, ctx);
    (resultado.borrados || []).forEach(function (b) { borrarFila_(ss, b.hoja, b.id); });
    resultado.upserts.forEach(function (u) { upsertFila_(ss, u.hoja, u.fila); });
    agregarHistorial_(ss, resultado.historial);
    SpreadsheetApp.flush();
    var datosNuevos = cargarDatos_(ss);
    return responder_({ ok: true, datos: datosNuevos, mensaje: resultado.mensaje });

  } catch (err) {
    return responder_({ ok: false, error: err.message || String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}

function validarPin_(pin) {
  var esperado = prop_('APP_PIN', false);
  if (!esperado) return false;
  return String(pin || '') === String(esperado);
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Para probar desde el editor sin frontend: corré esto y mirá el log
function pruebaCargarTodo() {
  var ss = abrirPlanilla_();
  var d = cargarDatos_(ss);
  Logger.log('locales=%s contratos=%s cuotas=%s pagos=%s mant=%s', d.locales.length, d.contratos.length, d.cuotas.length, d.pagos.length, d.mantenimiento.length);
  Logger.log('diagnóstico: %s', JSON.stringify(diagnosticarEsquema_(ss).concat(diagnosticarDatos_(d))));
}
