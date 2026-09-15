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

    // El cliente moderno pide la respuesta comprimida (gzip+base64, ~35 KB en vez de ~270 KB). Importante:
    // dos respuestas grandes simultáneas hacen que Google devuelva 404 en el redirect del web app.
    var aceptaGzip = !!(body.datos && body.datos.acepta_gzip);

    if (accion === 'cargarTodo') {
      var forzar = !!(body.datos && body.datos.forzar);
      var b64 = forzar ? null : leerCacheB64_();
      var desdeCache = !!b64, datosLeidos = null, diag = [];
      if (!b64) {
        datosLeidos = cargarDatos_(ss);
        b64 = comprimirDatos_(datosLeidos);
        guardarCacheB64_(b64);
        // El diagnóstico de esquema relee las hojas (~3 s): solo cuando el usuario pide actualizar a mano
        if (forzar) diag = diagnosticarEsquema_(ss).concat(diagnosticarDatos_(datosLeidos));
      }
      var base = { ok: true, diagnostico: diag, modo: 'api', desdeCache: desdeCache, planillaUrl: ss.getUrl(), planillaNombre: ss.getName() };
      if (aceptaGzip) { base.comprimido = true; base.b64_datos = b64; return responder_(base); }
      base.datos = datosLeidos || descomprimirDatos_(b64);
      return responder_(base);
    }

    // Diagnóstico paso a paso de la lectura (tiempos y errores), sin devolver los datos
    if (accion === 'diagnosticoLectura') {
      var pasos = [], t0 = Date.now(), datosD, textoD, gz, b64;
      function paso(nombre, fn) { var t = Date.now(); try { var r = fn(); pasos.push({ paso: nombre, ms: Date.now() - t, ok: true, info: r }); } catch (err) { pasos.push({ paso: nombre, ms: Date.now() - t, ok: false, error: String(err && err.message || err) }); } }
      paso('cargarDatos_', function () { datosD = cargarDatos_(ss); return Object.keys(datosD).map(function (k) { return k + '=' + (datosD[k].length || Object.keys(datosD[k]).length); }).join(' '); });
      paso('stringify', function () { textoD = JSON.stringify(datosD); return textoD.length + ' chars'; });
      paso('gzip', function () { gz = Utilities.gzip(Utilities.newBlob(textoD, 'application/json')).getBytes(); return gz.length + ' bytes'; });
      paso('base64', function () { b64 = Utilities.base64Encode(gz); return b64.length + ' chars'; });
      paso('putAll', function () { guardarCache_(datosD); return 'ok'; });
      paso('leerCache_', function () { var c = leerCache_(); return c ? 'hit locales=' + c.locales.length : 'miss'; });
      paso('diagnostico', function () { return diagnosticarEsquema_(ss).concat(diagnosticarDatos_(datosD)).length + ' avisos'; });
      return responder_({ ok: true, totalMs: Date.now() - t0, pasos: pasos });
    }

    if (!REGLAS.ACCIONES[accion]) return responder_({ ok: false, error: 'Acción desconocida: ' + accion });

    // Idempotencia: si el cliente reintenta una mutación ya procesada (porque se perdió la respuesta),
    // se devuelve el mismo resultado sin volver a escribir.
    var claveOp = body.datos && body.datos._op ? 'op_' + String(body.datos._op).slice(0, 60) : null;
    if (claveOp) {
      var previa = null;
      try { previa = CacheService.getScriptCache().get(claveOp); } catch (e0) { }
      if (previa) return ContentService.createTextOutput(previa).setMimeType(ContentService.MimeType.JSON);
    }

    // Mutaciones: serializadas con lock para que dos personas no pisen ids.
    // Se lee la planilla real (no la caché) para aplicar las reglas sobre lo último.
    lock.waitLock(20000);
    if (claveOp) {   // otra ejecución pudo haberla completado mientras esperábamos el lock
      var previa2 = null; try { previa2 = CacheService.getScriptCache().get(claveOp); } catch (e1) { }
      if (previa2) return ContentService.createTextOutput(previa2).setMimeType(ContentService.MimeType.JSON);
    }
    var d = cargarDatos_(ss);
    var ahora = new Date();
    var ctx = { usuario: usuario, hoy: REGLAS.hoyISO(ahora), ahora: REGLAS.ahoraISO(ahora) };
    var resultado = REGLAS.ejecutar(accion, d, body.datos || {}, ctx);
    (resultado.borrados || []).forEach(function (b) { borrarFila_(ss, b.hoja, b.id); });
    resultado.upserts.forEach(function (u) { upsertFila_(ss, u.hoja, u.fila); });
    agregarHistorial_(ss, resultado.historial);
    SpreadsheetApp.flush();
    // El estado nuevo es el que teníamos en memoria más lo recién escrito: no hace falta releer toda la planilla
    REGLAS.aplicar(d, resultado);
    var b64Nuevo = comprimirDatos_(d);
    guardarCacheB64_(b64Nuevo);
    var respuesta = aceptaGzip ? { ok: true, comprimido: true, b64_datos: b64Nuevo, mensaje: resultado.mensaje } : { ok: true, datos: d, mensaje: resultado.mensaje };
    var textoResp = JSON.stringify(respuesta);
    if (claveOp && textoResp.length < 95000) { try { CacheService.getScriptCache().put(claveOp, textoResp, 6 * 3600); } catch (e2) { } }
    return ContentService.createTextOutput(textoResp).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return responder_({ ok: false, error: err.message || String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}

// ---------- caché de lectura ----------
// Leer 8 hojas y armar el JSON tarda varios segundos; la caché lo baja a ~1 s. Se renueva sola con cada
// guardado desde la app y vence a los CACHE_MINUTOS por si alguien editó la planilla a mano
// (el botón ↻ de la app manda forzar=true y saltea la caché).
var CACHE_MINUTOS = 10;
var CACHE_TROZO = 90 * 1024;   // CacheService admite ~100 KB por clave

// Los datos viajan y se cachean como gzip+base64: el mismo string sirve para la caché y para la respuesta.
function comprimirDatos_(datos) {
  return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(datos), 'application/json')).getBytes());
}
function descomprimirDatos_(b64) {
  return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString());
}
function guardarCache_(datos) { guardarCacheB64_(comprimirDatos_(datos)); }
function guardarCacheB64_(texto) {
  try {
    var cache = CacheService.getScriptCache();
    var trozos = {}, n = 0;
    for (var i = 0; i < texto.length; i += CACHE_TROZO) trozos['datos_' + n++] = texto.substring(i, i + CACHE_TROZO);
    trozos['datos_meta'] = JSON.stringify({ n: n, t: Date.now() });
    cache.putAll(trozos, CACHE_MINUTOS * 60);
  } catch (e) { /* si la caché falla, la app sigue funcionando sin ella */ }
}
function leerCacheB64_() {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get('datos_meta'); if (!meta) return null;
    var n = JSON.parse(meta).n, claves = [];
    for (var i = 0; i < n; i++) claves.push('datos_' + i);
    var trozos = cache.getAll(claves), texto = '';
    for (var j = 0; j < n; j++) { if (!trozos['datos_' + j]) return null; texto += trozos['datos_' + j]; }
    return texto;
  } catch (e) { return null; }
}
function leerCache_() { var b64 = leerCacheB64_(); try { return b64 ? descomprimirDatos_(b64) : null; } catch (e) { return null; } }
function borrarCache_() { try { CacheService.getScriptCache().remove('datos_meta'); } catch (e) { } }

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
