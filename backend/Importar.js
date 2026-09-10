// ============================================================
//  IMPORTAR — punto de enganche para traer datos de planillas existentes de INGECO
//  (cobranzas, listado de locales, contratos). TODAVÍA NO HAY ACCESO A LA PLANILLA REAL:
//  cuando llegue, se completa MAPEO_* con los nombres reales de columna y se corre la función.
//  Regla: si falta o cambió una columna, se avisa y NO se importa nada. Nunca fallar en silencio.
// ============================================================

// Ejemplo de mapeo esperado → columna real en la planilla de cobranzas (ajustar cuando se conozca)
var MAPEO_COBRANZAS = {
  id_local: 'Local',          // o el nombre/número con el que identifican el local
  periodo: 'Período',         // AAAA-MM o "sep-26" (ver parsearPeriodo_)
  concepto: 'Concepto',       // ALQUILER / EXPENSAS
  fecha: 'Fecha de pago',
  monto: 'Importe',
  medio: 'Medio',
  comprobante: 'Comprobante',
};

// Lee una planilla externa y verifica que estén todas las columnas del mapeo. Devuelve {ok, faltantes, filas}
function verificarColumnas_(sheetId, nombreHoja, mapeo) {
  var ext = SpreadsheetApp.openById(sheetId);
  var sh = nombreHoja ? ext.getSheetByName(nombreHoja) : ext.getSheets()[0];
  if (!sh) return { ok: false, faltantes: [], error: 'No existe la hoja "' + nombreHoja + '" en la planilla ' + sheetId };
  var r = leerHoja_(ext, sh.getName());
  var faltantes = Object.keys(mapeo).filter(function (k) { return r.encabezados.indexOf(mapeo[k]) < 0; }).map(function (k) { return mapeo[k]; });
  return { ok: !faltantes.length, faltantes: faltantes, filas: r.filas, encabezados: r.encabezados };
}

// Simulación: muestra qué se importaría sin escribir nada. Correr primero SIEMPRE.
function previsualizarImportacionCobranzas(sheetId, nombreHoja) {
  var v = verificarColumnas_(sheetId, nombreHoja, MAPEO_COBRANZAS);
  if (!v.ok) {
    Logger.log('NO SE IMPORTA. %s Faltan columnas: %s. Encabezados encontrados: %s', v.error || '', v.faltantes.join(', '), (v.encabezados || []).join(' | '));
    return v;
  }
  Logger.log('Columnas OK. %s filas encontradas. Primeras 5: %s', v.filas.length, JSON.stringify(v.filas.slice(0, 5)));
  return v;
}

function parsearPeriodo_(v) {
  v = String(v || '').trim();
  if (/^\d{4}-\d{2}$/.test(v)) return v;
  var meses = { ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06', jul: '07', ago: '08', sep: '09', set: '09', oct: '10', nov: '11', dic: '12' };
  var m = v.toLowerCase().match(/^([a-z]{3})[a-z]*[-\/ ]?(\d{2,4})$/);
  if (m && meses[m[1]]) return (m[2].length === 2 ? '20' + m[2] : m[2]) + '-' + meses[m[1]];
  return null;
}
