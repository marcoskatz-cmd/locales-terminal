// ============================================================
//  DATOS — lectura/escritura de hojas como arrays de objetos.
//  Columnas por encabezado. Fechas siempre como texto AAAA-MM-DD.
// ============================================================

// Normaliza lo que viene de la celda. Tolera que alguien edite la planilla a mano:
// fechas como Date de Sheets o escritas "15/03/2025" -> "2025-03-15"; períodos "9/2026" o "sep-26" -> "2026-09".
function normalizar_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    var s = v.trim(), m;
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    if ((m = s.match(/^(\d{1,2})\/(\d{4})$/))) return m[2] + '-' + ('0' + m[1]).slice(-2);
    return s;
  }
  return v;
}

// Devuelve { filas: [obj], encabezados: [..], hoja } para una hoja
function leerHoja_(ss, nombre) {
  var sh = ss.getSheetByName(nombre);
  if (!sh) return { filas: [], encabezados: [], hoja: null };
  var rango = sh.getDataRange().getValues();
  if (!rango.length) return { filas: [], encabezados: [], hoja: sh };
  var enc = rango[0].map(function (h) { return String(h).trim(); });
  var filas = [];
  for (var i = 1; i < rango.length; i++) {
    var fila = rango[i];
    if (fila.every(function (c) { return c === '' || c === null; })) continue;
    var o = { _fila: i + 1 };
    enc.forEach(function (h, j) { if (h) o[h] = normalizar_(fila[j]); });
    filas.push(o);
  }
  return { filas: filas, encabezados: enc, hoja: sh };
}

function leerListas_(ss) {
  var r = leerHoja_(ss, 'LISTAS');
  var out = {};
  r.encabezados.forEach(function (h) {
    if (!h) return;
    out[h] = r.filas.map(function (f) { return String(f[h] || '').trim(); }).filter(function (v) { return v; });
  });
  return out;
}

// Lee todas las hojas y arma el objeto `datos` que consumen REGLAS y el frontend
function cargarDatos_(ss) {
  var datos = { listas: leerListas_(ss) };
  Object.keys(REGLAS.HOJA_A_KEY).forEach(function (hoja) {
    var r = leerHoja_(ss, hoja);
    datos[REGLAS.HOJA_A_KEY[hoja]] = r.filas.map(function (f) {
      var o = {}; Object.keys(f).forEach(function (k) { if (k !== '_fila') o[k] = f[k]; });
      if (hoja === 'LOCALES') o.activo = String(o.activo).toUpperCase() !== 'FALSE' && o.activo !== false && o.activo !== 'NO';
      return o;
    });
  });
  return datos;
}

// Inserta o actualiza una fila (por columna clave) respetando el orden de encabezados real de la hoja
function upsertFila_(ss, hoja, fila) {
  var r = leerHoja_(ss, hoja);
  if (!r.hoja) throw new Error('No existe la hoja ' + hoja + ' en la planilla.');
  var clave = REGLAS.CLAVES[hoja];
  var valores = r.encabezados.map(function (h) {
    var v = fila[h];
    if (v === undefined || v === null) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return v;
  });
  var existente = clave ? r.filas.filter(function (f) { return f[clave] === fila[clave]; })[0] : null;
  var numFila = existente ? existente._fila : r.hoja.getLastRow() + 1;
  var rango = r.hoja.getRange(numFila, 1, 1, valores.length);
  // Forzar texto plano en las columnas sensibles ANTES de escribir, así Sheets no convierte fechas ni ceros a la izquierda
  var textoCols = COLUMNAS_TEXTO[hoja] || [];
  r.encabezados.forEach(function (h, j) { if (textoCols.indexOf(h) >= 0) r.hoja.getRange(numFila, j + 1).setNumberFormat('@'); });
  rango.setValues([valores]);
  return numFila;
}

// Borra la fila cuya columna clave vale `id`. Devuelve true si la encontró.
function borrarFila_(ss, hoja, id) {
  var r = leerHoja_(ss, hoja);
  if (!r.hoja) throw new Error('No existe la hoja ' + hoja + ' en la planilla.');
  var clave = REGLAS.CLAVES[hoja];
  var fila = r.filas.filter(function (f) { return f[clave] === id; })[0];
  if (!fila) return false;
  r.hoja.deleteRow(fila._fila);
  return true;
}

function agregarHistorial_(ss, entradas) {
  if (!entradas || !entradas.length) return;
  var r = leerHoja_(ss, 'HISTORIAL');
  if (!r.hoja) return;
  var filas = entradas.map(function (e) { return r.encabezados.map(function (h) { return e[h] === undefined ? '' : e[h]; }); });
  var inicio = r.hoja.getLastRow() + 1;
  r.hoja.getRange(inicio, 1, filas.length, r.encabezados.length).setNumberFormat('@').setValues(filas);
}
