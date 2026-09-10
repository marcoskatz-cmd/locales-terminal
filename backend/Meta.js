// ============================================================
//  META — auto-diagnóstico del esquema.
//  Compara los encabezados reales de la planilla con ESQUEMA y devuelve avisos en español.
//  Se manda en cada cargarTodo; el frontend lo muestra como banner. Nunca falla en silencio.
// ============================================================
function diagnosticarEsquema_(ss) {
  var avisos = [];
  Object.keys(ESQUEMA).forEach(function (hoja) {
    var r = leerHoja_(ss, hoja);
    if (!r.hoja) { avisos.push('Falta la hoja "' + hoja + '".'); return; }
    var esperadas = ESQUEMA[hoja], reales = r.encabezados.filter(function (h) { return h; });
    esperadas.forEach(function (c) { if (reales.indexOf(c) < 0) avisos.push('Hoja ' + hoja + ': falta la columna "' + c + '".'); });
    reales.forEach(function (c) { if (esperadas.indexOf(c) < 0) avisos.push('Hoja ' + hoja + ': la columna "' + c + '" no es parte del esquema (¿se renombró alguna?).'); });
    var vistos = {};
    reales.forEach(function (c) { if (vistos[c]) avisos.push('Hoja ' + hoja + ': la columna "' + c + '" está repetida.'); vistos[c] = true; });
  });
  var listas = leerHoja_(ss, 'LISTAS');
  if (!listas.hoja) avisos.push('Falta la hoja "LISTAS" (los desplegables van a salir vacíos).');
  else COLUMNAS_LISTAS.forEach(function (c) { if (listas.encabezados.indexOf(c) < 0) avisos.push('Hoja LISTAS: falta la columna "' + c + '".'); });

  var meta = leerHoja_(ss, 'META');
  if (meta.hoja) {
    var v = meta.filas.filter(function (f) { return f.clave === 'version_esquema'; })[0];
    if (v && Number(v.valor) !== VERSION_ESQUEMA) avisos.push('La planilla tiene esquema v' + v.valor + ' y la app espera v' + VERSION_ESQUEMA + '.');
  }
  return avisos;
}

// Integridad básica de los datos (referencias rotas). También se muestra como aviso.
function diagnosticarDatos_(datos) {
  var avisos = [];
  var ids = {}; datos.locales.forEach(function (l) { if (ids[l.id_local]) avisos.push('LOCALES: id repetido ' + l.id_local + '.'); ids[l.id_local] = true; });
  datos.contratos.forEach(function (c) { if (!ids[c.id_local]) avisos.push('CONTRATOS: ' + c.id_contrato + ' apunta a un local inexistente (' + c.id_local + ').'); });
  var porLocal = {};
  datos.contratos.forEach(function (c) { if (c.estado_contrato === 'VIGENTE') { porLocal[c.id_local] = (porLocal[c.id_local] || 0) + 1; } });
  Object.keys(porLocal).forEach(function (l) { if (porLocal[l] > 1) avisos.push('El local ' + l + ' tiene ' + porLocal[l] + ' contratos VIGENTES a la vez.'); });
  var qids = {}; datos.cuotas.forEach(function (q) { qids[q.id_cuota] = true; });
  datos.pagos.forEach(function (p) { if (!qids[p.id_cuota]) avisos.push('PAGOS: ' + p.id_pago + ' apunta a una cuota inexistente (' + p.id_cuota + ').'); });
  return avisos;
}
