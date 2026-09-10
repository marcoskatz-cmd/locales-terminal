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

  async function postApi(accion, datos) {
    var r;
    try {
      r = await fetch(CONFIG.API_URL, {
        method: 'POST',
        // text/plain evita el preflight CORS que Apps Script no responde
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ accion: accion, pin: pin, datos: datos || {} })
      });
    } catch (e) {
      throw new Error('No se pudo conectar con el servidor. Revisá la conexión e intentá de nuevo.');
    }
    var j;
    try { j = await r.json(); } catch (e) { throw new Error('El servidor respondió algo inesperado. Avisale a sistemas.'); }
    if (!j.ok) {
      if (j.codigo === 'PIN') { olvidarPin(); }
      throw new Error(j.error || 'Error desconocido.');
    }
    return j;
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
    cargarTodo: function () { return post('cargarTodo', {}); },
    guardarLocal: function (p) { return post('guardarLocal', p); },
    guardarContrato: function (p) { return post('guardarContrato', p); },
    generarCuotas: function (p) { return post('generarCuotas', p); },
    registrarPago: function (p) { return post('registrarPago', p); },
    guardarMantenimiento: function (p) { return post('guardarMantenimiento', p); },
  };
})();
