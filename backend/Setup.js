// ============================================================
//  SETUP — se corre UNA vez desde el editor de Apps Script (Ejecutar > setupApp).
//  Crea la planilla con todas las hojas, encabezados, validaciones y datos ficticios,
//  y guarda el id y el PIN en Script Properties.
// ============================================================

function setupApp() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('APP_SHEET_ID')) throw new Error('Ya hay una planilla configurada (APP_SHEET_ID). Si querés empezar de cero borrá la propiedad primero.');

  var ss = SpreadsheetApp.create('Locales Terminal - Datos');
  props.setProperty('APP_SHEET_ID', ss.getId());
  if (!props.getProperty('APP_PIN')) props.setProperty('APP_PIN', '1234'); // CAMBIAR después en Configuración del proyecto

  crearEstructura_(ss);
  sembrarMock_(ss);

  var primera = ss.getSheets()[0];
  if (primera.getName() === 'Hoja 1' || primera.getName() === 'Sheet1') ss.deleteSheet(primera);
  Logger.log('Planilla creada: %s', ss.getUrl());
  Logger.log('PIN inicial: %s  (cambialo en Configuración del proyecto > Propiedades del script > APP_PIN)', props.getProperty('APP_PIN'));
  return ss.getUrl();
}

function crearEstructura_(ss) {
  // LISTAS primero, porque las validaciones de las otras hojas apuntan acá
  var listas = ss.insertSheet('LISTAS');
  listas.getRange(1, 1, 1, COLUMNAS_LISTAS.length).setValues([COLUMNAS_LISTAS]).setFontWeight('bold');
  var maxLen = 0; COLUMNAS_LISTAS.forEach(function (c) { maxLen = Math.max(maxLen, (MOCK.listas[c] || []).length); });
  var matriz = [];
  for (var i = 0; i < maxLen; i++) matriz.push(COLUMNAS_LISTAS.map(function (c) { return (MOCK.listas[c] || [])[i] || ''; }));
  if (matriz.length) listas.getRange(2, 1, matriz.length, COLUMNAS_LISTAS.length).setValues(matriz);
  listas.setFrozenRows(1);

  var plantas = ss.insertSheet('PLANTAS');
  plantas.getRange(1, 1, 1, 2).setValues([['id', 'nombre']]).setFontWeight('bold');
  plantas.getRange(2, 1, 3, 2).setValues([['PB', 'Planta baja'], ['PA', 'Planta alta (oficinas)'], ['EXT', 'Predio / exteriores']]);

  Object.keys(ESQUEMA).forEach(function (hoja) {
    var sh = ss.insertSheet(hoja);
    var enc = ESQUEMA[hoja];
    sh.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold').setBackground('#e2e8f0');
    sh.setFrozenRows(1);
    (COLUMNAS_TEXTO[hoja] || []).forEach(function (c) { var j = enc.indexOf(c); if (j >= 0) sh.getRange(2, j + 1, 1000, 1).setNumberFormat('@'); });
    var val = VALIDACIONES[hoja] || {};
    Object.keys(val).forEach(function (col) {
      var j = enc.indexOf(col); if (j < 0) return;
      var regla;
      if (Array.isArray(val[col])) regla = SpreadsheetApp.newDataValidation().requireValueInList(val[col], true);
      else if (val[col] === 'PLANTAS') regla = SpreadsheetApp.newDataValidation().requireValueInRange(plantas.getRange('A2:A50'), true);
      else { var k = COLUMNAS_LISTAS.indexOf(val[col]); if (k < 0) return; regla = SpreadsheetApp.newDataValidation().requireValueInRange(listas.getRange(2, k + 1, 200, 1), true); }
      sh.getRange(2, j + 1, 1000, 1).setDataValidation(regla.setAllowInvalid(false).build());
    });
    sh.autoResizeColumns(1, enc.length);
  });

  var meta = ss.insertSheet('META');
  meta.getRange(1, 1, 3, 2).setValues([['clave', 'valor'], ['version_esquema', VERSION_ESQUEMA], ['creado', new Date().toISOString()]]);
  meta.getRange(1, 1, 1, 2).setFontWeight('bold');
}

function sembrarMock_(ss) {
  Object.keys(REGLAS.HOJA_A_KEY).forEach(function (hoja) {
    var filas = MOCK[REGLAS.HOJA_A_KEY[hoja]] || [];
    if (!filas.length) return;
    var enc = ESQUEMA[hoja];
    var matriz = filas.map(function (f) { return enc.map(function (c) { var v = f[c]; if (v === undefined || v === null) return ''; if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'; return v; }); });
    ss.getSheetByName(hoja).getRange(2, 1, matriz.length, enc.length).setValues(matriz);
  });
}

// Borra los datos ficticios (deja encabezados, LISTAS y PLANTAS). Correr antes de cargar los datos reales.
function borrarDatosMock() {
  var ss = abrirPlanilla_();
  Object.keys(ESQUEMA).forEach(function (hoja) {
    var sh = ss.getSheetByName(hoja); if (!sh) return;
    var n = sh.getLastRow() - 1;
    if (n > 0) sh.getRange(2, 1, n, sh.getLastColumn()).clearContent();
  });
  Logger.log('Datos ficticios borrados. LISTAS y PLANTAS quedaron intactas.');
}

// Si editaste la planilla a mano y querés que la app lo vea ya (sin esperar los 10 minutos ni tocar ↻)
function limpiarCache() { borrarCache_(); Logger.log('Caché borrada. La próxima lectura va directo a la planilla.'); }

// Cambiar el PIN sin entrar a la configuración del proyecto
function cambiarPin(nuevo) {
  if (!nuevo || String(nuevo).length < 4) throw new Error('El PIN tiene que tener al menos 4 caracteres.');
  PropertiesService.getScriptProperties().setProperty('APP_PIN', String(nuevo));
  Logger.log('PIN actualizado.');
}
