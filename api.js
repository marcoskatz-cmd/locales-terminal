// ============================================================
//  CAPA DE ACCESO A DATOS
//  - Modo API  (CONFIG.API_URL definido): POST JSON a Apps Script.
//  - Modo demo (CONFIG.API_URL vacío): carga mock/datos.json y aplica REGLAS en memoria.
//  El resto de la app no distingue entre los dos.
// ============================================================
var API = (function () {
  var modoDemo = !CONFIG.API_URL;
  var pin = '';
  var mock = null;
  try { pin = localStorage.getItem('locales_pin') || ''; } catch (e) { }

  function guardarPin(p) { pin = p; try { localStorage.setItem('locales_pin', p); } catch (e) { } }
  function olvidarPin() { pin = ''; try { localStorage.removeItem('locales_pin'); } catch (e) { } }

  // Respuestas comprimidas: el servidor manda los datos como gzip+base64 (7 veces más chico) si el navegador
  // sabe descomprimir. Además de rapidez, evita un límite de Google: dos respuestas grandes a la vez dan 404.
  var puedeGzip = typeof DecompressionStream !== 'undefined';
  async function descomprimir(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }

  // Apps Script devuelve una página 404 cuando recibe varias respuestas grandes a la vez. Por eso:
  //  1) las llamadas de esta pestaña van de a una (cola),
  //  2) si la respuesta no es JSON se reintenta hasta 3 veces con espera creciente,
  //  3) cada mutación lleva una clave única (_op): si el servidor ya la procesó, devuelve el mismo
  //     resultado sin repetir la escritura. Así reintentar nunca duplica un pago.
  var cola = Promise.resolve();
  function enCola(fn) { var p = cola.then(fn, fn); cola = p.then(function () { }, function () { }); return p; }
  function esperar(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function uuid() { return 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }

  async function postApiUnaVez(accion, cuerpo) {
    var r;
    try {
      r = await fetch(CONFIG.API_URL, {
        method: 'POST',
        // text/plain evita el preflight CORS que Apps Script no responde
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ accion: accion, pin: pin, datos: cuerpo })
      });
    } catch (e) {
      var eRed = new Error('No se pudo conectar con el servidor. Revisá la conexión e intentá de nuevo.'); eRed.reintentable = true; throw eRed;
    }
    var j;
    try { j = await r.json(); } catch (e) { var eFmt = new Error('El servidor respondió algo inesperado (' + r.status + '). Probá de nuevo en unos segundos.'); eFmt.reintentable = true; throw eFmt; }
    if (!j.ok) {
      if (j.codigo === 'PIN') { olvidarPin(); }
      throw new Error(j.error || 'Error desconocido.');
    }
    if (j.comprimido && j.b64_datos) {
      try { j.datos = await descomprimir(j.b64_datos); } catch (e) { throw new Error('No se pudieron leer los datos comprimidos: ' + e.message); }
      delete j.b64_datos;
    }
    return j;
  }

  function postApi(accion, datos) {
    var cuerpo = Object.assign({}, datos || {});
    if (puedeGzip) cuerpo.acepta_gzip = true;
    if (accion !== 'cargarTodo' && accion !== 'validarPin') cuerpo._op = uuid();
    return enCola(async function () {
      var ultimo;
      for (var intento = 1; intento <= 3; intento++) {
        try { return await postApiUnaVez(accion, cuerpo); }
        catch (e) { ultimo = e; if (!e.reintentable || intento === 3) throw e; await esperar(1200 * intento); }
      }
      throw ultimo;
    });
  }

  async function cargarMock() {
    if (mock) return mock;
    var r = await fetch('mock/datos.json?v=' + Date.now());
    mock = await r.json();
    return mock;
  }

  async function postDemo(accion, datos) {
    await new Promise(function (res) { setTimeout(res, 120); }); // simula red
    if (accion === 'validarPin') {
      if (String(datos.pin) !== String(CONFIG.MOCK_PIN)) return { ok: false, codigo: 'PIN', error: 'PIN incorrecto.' };
      return { ok: true };
    }
    if (pin !== String(CONFIG.MOCK_PIN)) return { ok: false, codigo: 'PIN', error: 'PIN incorrecto.' };
    var d = await cargarMock();
    if (accion === 'cargarTodo') return { ok: true, datos: d, diagnostico: [], modo: 'demo' };
    var ctx = { usuario: 'demo', hoy: REGLAS.hoyISO(), ahora: REGLAS.ahoraISO() };
    var resultado = REGLAS.ejecutar(accion, d, datos, ctx);
    REGLAS.aplicar(d, resultado);
    return { ok: true, datos: d, mensaje: resultado.mensaje };
  }

  async function post(accion, datos) {
    if (modoDemo) {
      var j = await postDemo(accion, datos);
      if (!j.ok) { if (j.codigo === 'PIN') olvidarPin(); throw new Error(j.error); }
      return j;
    }
    return postApi(accion, datos);
  }

  return {
    modoDemo: modoDemo,
    tienePin: function () { return !!pin; },
    validarPin: async function (p) {
      var j;
      if (modoDemo) { j = await postDemo('validarPin', { pin: p }); if (!j.ok) throw new Error(j.error); }
      else {
        var r = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ accion: 'validarPin', pin: p, datos: {} }) });
        j = await r.json(); if (!j.ok) throw new Error(j.error || 'PIN incorrecto.');
      }
      guardarPin(p);
      return true;
    },
    salir: olvidarPin,
    cargarTodo: function (p) { return post('cargarTodo', p || {}); },
    guardarLocal: function (p) { return post('guardarLocal', p); },
    guardarContrato: function (p) { return post('guardarContrato', p); },
    generarCuotas: function (p) { return post('generarCuotas', p); },
    registrarPago: function (p) { return post('registrarPago', p); },
    anularCuota: function (p) { return post('anularCuota', p); },
    guardarMantenimiento: function (p) { return post('guardarMantenimiento', p); },
  };
})();
