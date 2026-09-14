// ============================================================
//  REGLAS DE NEGOCIO — compartidas por el frontend (modo demo) y por Apps Script.
//  Funciones puras: reciben `datos` (todas las hojas como arrays de objetos) y un payload,
//  y devuelven { upserts: [{hoja, fila}], historial: [...], mensaje }.
//  Nunca tocan Sheets ni el DOM. Lanzan Error con mensaje en español si algo no es válido.
//  Este archivo se carga en index.html y se pushea a Apps Script tal cual (sin export/import).
// ============================================================
var REGLAS = (function () {

  var CLAVES = { LOCALES: 'id_local', CONTRATOS: 'id_contrato', CUOTAS: 'id_cuota', PAGOS: 'id_pago', MANTENIMIENTO: 'id_mant' };
  var HOJA_A_KEY = { LOCALES: 'locales', CONTRATOS: 'contratos', CUOTAS: 'cuotas', PAGOS: 'pagos', MANTENIMIENTO: 'mantenimiento', HISTORIAL: 'historial' };

  var ESTADOS_LOCAL = ['LIBRE', 'ALQUILADO', 'REFACCION', 'JUDICIAL'];
  var ESTADOS_CONTRATO = ['VIGENTE', 'FINALIZADO', 'RESCINDIDO'];
  var CONCEPTOS = ['ALQUILER', 'EXPENSAS'];
  var ESTADOS_CUOTA = ['PENDIENTE', 'PARCIAL', 'PAGADA'];
  var PRIORIDADES = ['ALTA', 'MEDIA', 'BAJA'];
  var ESTADOS_MANT = ['PENDIENTE', 'EN CURSO', 'RESUELTO'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hoyISO(fecha) {
    var d = fecha || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function ahoraISO(fecha) {
    var d = fecha || new Date();
    return hoyISO(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  // Acepta números JS tal cual, y texto en formato es-AR ("1.200.000,50") o técnico ("1200000.5")
  function num(v) {
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    var s = String(v === undefined || v === null ? '' : v).trim().replace(/\$/g, '').replace(/\s/g, '');
    if (!s) return 0;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    var n = Number(s); return isNaN(n) ? 0 : n;
  }
  function txt(v) { return v === undefined || v === null ? '' : String(v).trim(); }
  function enLista(v, lista, nombre) {
    if (lista.indexOf(v) < 0) throw new Error(nombre + ' inválido: "' + v + '". Opciones: ' + lista.join(', '));
    return v;
  }
  function esFechaISO(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function exigirFecha(v, nombre) { v = txt(v); if (!esFechaISO(v)) throw new Error(nombre + ' tiene que ser una fecha (AAAA-MM-DD).'); return v; }
  function esPeriodo(v) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(v); }

  function siguienteId(filas, campo, prefijo) {
    var max = 0, ancho = 3;
    filas.forEach(function (f) {
      var m = String(f[campo] || '').match(new RegExp('^' + prefijo + '-(\\d+)$'));
      if (m) { max = Math.max(max, parseInt(m[1], 10)); ancho = Math.max(ancho, m[1].length); }   // respeta el ancho ya usado (Q-0406 → Q-0407)
    });
    var n = String(max + 1);
    while (n.length < ancho) n = '0' + n;
    return prefijo + '-' + n;
  }

  function buscar(datos, hoja, id) {
    var key = HOJA_A_KEY[hoja], clave = CLAVES[hoja];
    for (var i = 0; i < datos[key].length; i++) if (datos[key][i][clave] === id) return datos[key][i];
    return null;
  }
  function contratoVigente(datos, idLocal) {
    return datos.contratos.filter(function (c) { return c.id_local === idLocal && c.estado_contrato === 'VIGENTE'; })[0] || null;
  }
  function clonar(o) { return JSON.parse(JSON.stringify(o)); }

  // Genera entradas de historial comparando campo a campo
  function diff(ctx, entidad, id, antes, despues, campos) {
    var out = [];
    campos.forEach(function (c) {
      var a = txt(antes ? antes[c] : ''), b = txt(despues[c]);
      if (a !== b) out.push({ fecha: ctx.ahora, usuario: ctx.usuario, entidad: entidad, id: id, campo: c, valor_anterior: a, valor_nuevo: b });
    });
    return out;
  }
  function alta(ctx, entidad, id, resumen) {
    return [{ fecha: ctx.ahora, usuario: ctx.usuario, entidad: entidad, id: id, campo: '(alta)', valor_anterior: '', valor_nuevo: resumen }];
  }

  // ---------- LOCALES ----------
  var CAMPOS_LOCAL = ['nombre', 'categoria', 'planta', 'sector', 'zonas', 'm2', 'rubro', 'estado', 'observaciones'];
  function guardarLocal(datos, p, ctx) {
    var actual = buscar(datos, 'LOCALES', txt(p.id_local));
    if (!actual) throw new Error('No existe el local ' + p.id_local + '.');
    var nuevo = clonar(actual);
    CAMPOS_LOCAL.forEach(function (c) { if (p[c] !== undefined) nuevo[c] = c === 'm2' ? num(p[c]) : txt(p[c]); });
    enLista(nuevo.estado, ESTADOS_LOCAL, 'Estado del local');
    if (datos.listas && datos.listas.categorias && txt(nuevo.categoria)) enLista(nuevo.categoria, datos.listas.categorias, 'Categoría');
    var vig = contratoVigente(datos, nuevo.id_local);
    if (nuevo.estado === 'LIBRE' && vig) throw new Error('El local tiene un contrato vigente con ' + vig.inquilino + '. Finalizalo antes de marcarlo LIBRE.');
    if (nuevo.estado === 'ALQUILADO' && !vig) throw new Error('No hay contrato vigente. Cargá el contrato primero: eso pone el local en ALQUILADO solo.');
    // JUDICIAL y REFACCION se pueden marcar con o sin contrato (un ocupante en litigio puede no tener contrato vigente)
    return { upserts: [{ hoja: 'LOCALES', fila: nuevo }], historial: diff(ctx, 'LOCALES', nuevo.id_local, actual, nuevo, CAMPOS_LOCAL), mensaje: 'Local guardado.' };
  }

  // ---------- CONTRATOS ----------
  var CAMPOS_CONTRATO = ['inquilino', 'cuit', 'contacto', 'fecha_inicio', 'fecha_fin', 'monto_alquiler', 'indice_ajuste',
    'periodicidad_meses', 'proxima_fecha_ajuste', 'deposito', 'expensas_mensuales', 'estado_contrato', 'observaciones'];
  function guardarContrato(datos, p, ctx) {
    var upserts = [], hist = [], mensaje;
    var idLocal = txt(p.id_local);
    var local = buscar(datos, 'LOCALES', idLocal);
    if (!local) throw new Error('No existe el local ' + idLocal + '.');
    var actual = p.id_contrato ? buscar(datos, 'CONTRATOS', txt(p.id_contrato)) : null;
    if (p.id_contrato && !actual) throw new Error('No existe el contrato ' + p.id_contrato + '.');

    var nuevo = actual ? clonar(actual) : { id_contrato: siguienteId(datos.contratos, 'id_contrato', 'C'), id_local: idLocal, estado_contrato: 'VIGENTE' };
    CAMPOS_CONTRATO.forEach(function (c) {
      if (p[c] === undefined) return;
      if (['monto_alquiler', 'deposito', 'expensas_mensuales', 'periodicidad_meses'].indexOf(c) >= 0) nuevo[c] = num(p[c]);
      else nuevo[c] = txt(p[c]);
    });
    if (!txt(nuevo.inquilino)) throw new Error('Falta el nombre del inquilino.');
    exigirFecha(nuevo.fecha_inicio, 'Fecha de inicio');
    exigirFecha(nuevo.fecha_fin, 'Fecha de fin');
    if (nuevo.fecha_fin <= nuevo.fecha_inicio) throw new Error('La fecha de fin tiene que ser posterior al inicio.');
    if (!(num(nuevo.monto_alquiler) > 0)) throw new Error('El monto de alquiler tiene que ser mayor a cero.');
    if (txt(nuevo.proxima_fecha_ajuste) && !esFechaISO(nuevo.proxima_fecha_ajuste)) throw new Error('La próxima fecha de ajuste no es válida.');
    enLista(nuevo.estado_contrato, ESTADOS_CONTRATO, 'Estado del contrato');
    if (datos.listas && datos.listas.indices_ajuste && txt(nuevo.indice_ajuste)) enLista(nuevo.indice_ajuste, datos.listas.indices_ajuste, 'Índice de ajuste');

    var otroVigente = datos.contratos.filter(function (c) { return c.id_local === idLocal && c.estado_contrato === 'VIGENTE' && c.id_contrato !== nuevo.id_contrato; })[0];
    if (nuevo.estado_contrato === 'VIGENTE' && otroVigente) throw new Error('El local ya tiene un contrato vigente (' + otroVigente.id_contrato + ' · ' + otroVigente.inquilino + ').');

    upserts.push({ hoja: 'CONTRATOS', fila: nuevo });
    hist = actual ? diff(ctx, 'CONTRATOS', nuevo.id_contrato, actual, nuevo, CAMPOS_CONTRATO)
      : alta(ctx, 'CONTRATOS', nuevo.id_contrato, nuevo.inquilino + ' · ' + idLocal);

    // El estado del local sigue al contrato (POKAYOKE: nadie lo marca a mano)
    var estadoLocalNuevo = null;
    if (nuevo.estado_contrato === 'VIGENTE' && local.estado === 'LIBRE') estadoLocalNuevo = 'ALQUILADO';          // REFACCION / JUDICIAL se respetan
    if (nuevo.estado_contrato !== 'VIGENTE' && actual && actual.estado_contrato === 'VIGENTE' && (local.estado === 'ALQUILADO' || local.estado === 'JUDICIAL')) estadoLocalNuevo = 'LIBRE';
    if (estadoLocalNuevo) {
      var l2 = clonar(local); l2.estado = estadoLocalNuevo;
      upserts.push({ hoja: 'LOCALES', fila: l2 });
      hist = hist.concat(diff(ctx, 'LOCALES', idLocal, local, l2, ['estado']));
    }
    mensaje = actual ? 'Contrato actualizado.' : 'Contrato creado. El local pasó a ALQUILADO.';
    if (estadoLocalNuevo === 'LIBRE') mensaje = 'Contrato cerrado. El local pasó a LIBRE.';
    return { upserts: upserts, historial: hist, mensaje: mensaje };
  }

  // ---------- CUOTAS ----------
  function generarCuotas(datos, p, ctx) {
    var periodo = txt(p.periodo);
    if (!esPeriodo(periodo)) throw new Error('Período inválido. Formato AAAA-MM.');
    var inicioPer = periodo + '-01', finPer = periodo + '-31';
    var venc = periodo + '-10';
    var upserts = [], hist = [], creadas = 0;
    var existentes = {};
    datos.cuotas.forEach(function (q) { existentes[q.id_contrato + '|' + q.periodo + '|' + q.concepto] = true; });
    var nuevas = [];
    datos.contratos.forEach(function (c) {
      if (c.estado_contrato !== 'VIGENTE') return;
      if (c.fecha_inicio > finPer) return;
      if (c.fecha_fin && c.fecha_fin < inicioPer) return;
      [['ALQUILER', num(c.monto_alquiler)], ['EXPENSAS', num(c.expensas_mensuales)]].forEach(function (par) {
        if (!(par[1] > 0)) return;
        if (existentes[c.id_contrato + '|' + periodo + '|' + par[0]]) return;
        var q = { id_cuota: siguienteId(datos.cuotas.concat(nuevas), 'id_cuota', 'Q'), id_contrato: c.id_contrato, id_local: c.id_local,
          periodo: periodo, concepto: par[0], monto: par[1], vencimiento: venc, estado: 'PENDIENTE' };
        nuevas.push(q);
        upserts.push({ hoja: 'CUOTAS', fila: q });
        creadas++;
      });
    });
    if (creadas) hist = alta(ctx, 'CUOTAS', periodo, creadas + ' cuotas generadas');
    return { upserts: upserts, historial: hist, mensaje: creadas ? 'Se generaron ' + creadas + ' cuotas para ' + periodo + '.' : 'No había cuotas nuevas para generar en ' + periodo + '.' };
  }

  // ---------- PAGOS ----------
  function saldoCuota(datos, cuota) {
    var pagado = 0;
    datos.pagos.forEach(function (pg) { if (pg.id_cuota === cuota.id_cuota) pagado += num(pg.monto); });
    return Math.max(0, num(cuota.monto) - pagado);
  }
  function registrarPago(datos, p, ctx) {
    var cuota = buscar(datos, 'CUOTAS', txt(p.id_cuota));
    if (!cuota) throw new Error('No existe la cuota ' + p.id_cuota + '.');
    if (cuota.estado === 'PAGADA') throw new Error('Esa cuota ya está pagada.');
    var monto = num(p.monto), saldo = saldoCuota(datos, cuota);
    if (!(monto > 0)) throw new Error('El monto tiene que ser mayor a cero.');
    if (monto > saldo + 0.01) throw new Error('El monto supera el saldo de la cuota (' + saldo + ').');
    var medio = txt(p.medio);
    if (datos.listas && datos.listas.medios_pago) enLista(medio, datos.listas.medios_pago, 'Medio de pago');
    var pago = { id_pago: siguienteId(datos.pagos, 'id_pago', 'P'), id_cuota: cuota.id_cuota, id_local: cuota.id_local,
      fecha: exigirFecha(p.fecha || ctx.hoy, 'Fecha de pago'), monto: monto, medio: medio, comprobante: txt(p.comprobante), observaciones: txt(p.observaciones) };
    var q2 = clonar(cuota);
    q2.estado = (saldo - monto) <= 0.01 ? 'PAGADA' : 'PARCIAL';
    var hist = alta(ctx, 'PAGOS', pago.id_pago, cuota.id_local + ' · ' + cuota.concepto + ' ' + cuota.periodo + ' · $' + monto)
      .concat(diff(ctx, 'CUOTAS', cuota.id_cuota, cuota, q2, ['estado']));
    return { upserts: [{ hoja: 'PAGOS', fila: pago }, { hoja: 'CUOTAS', fila: q2 }], historial: hist,
      mensaje: q2.estado === 'PAGADA' ? 'Pago registrado. La cuota quedó PAGADA.' : 'Pago parcial registrado. Saldo: $' + (saldo - monto) + '.' };
  }

  // Anular una cuota generada por error. Solo si no tiene pagos imputados (si los tiene, primero hay que resolver eso).
  function anularCuota(datos, p, ctx) {
    var cuota = buscar(datos, 'CUOTAS', txt(p.id_cuota));
    if (!cuota) throw new Error('No existe la cuota ' + p.id_cuota + '.');
    var conPagos = datos.pagos.some(function (pg) { return pg.id_cuota === cuota.id_cuota; });
    if (conPagos) throw new Error('La cuota ' + cuota.id_cuota + ' tiene pagos imputados: no se puede anular.');
    return { upserts: [], borrados: [{ hoja: 'CUOTAS', id: cuota.id_cuota }],
      historial: [{ fecha: ctx.ahora, usuario: ctx.usuario, entidad: 'CUOTAS', id: cuota.id_cuota, campo: '(anulada)', valor_anterior: cuota.id_local + ' · ' + cuota.concepto + ' ' + cuota.periodo + ' · $' + cuota.monto, valor_nuevo: txt(p.motivo) }],
      mensaje: 'Cuota anulada.' };
  }

  // ---------- MANTENIMIENTO ----------
  var CAMPOS_MANT = ['id_local', 'planta', 'fecha_reporte', 'tipo_falla', 'descripcion', 'prioridad', 'estado', 'quien_intervino', 'fecha_resolucion', 'costo', 'fotos', 'observaciones'];
  function guardarMantenimiento(datos, p, ctx) {
    var actual = p.id_mant ? buscar(datos, 'MANTENIMIENTO', txt(p.id_mant)) : null;
    if (p.id_mant && !actual) throw new Error('No existe la falla ' + p.id_mant + '.');
    var nuevo = actual ? clonar(actual) : { id_mant: siguienteId(datos.mantenimiento, 'id_mant', 'M'), estado: 'PENDIENTE', fecha_reporte: ctx.hoy };
    CAMPOS_MANT.forEach(function (c) { if (p[c] !== undefined) nuevo[c] = c === 'costo' ? (txt(p[c]) === '' ? '' : num(p[c])) : txt(p[c]); });
    if (nuevo.id_local !== 'COMUN' && !buscar(datos, 'LOCALES', nuevo.id_local)) throw new Error('No existe el local ' + nuevo.id_local + '.');
    if (nuevo.id_local !== 'COMUN') nuevo.planta = buscar(datos, 'LOCALES', nuevo.id_local).planta;
    if (!txt(nuevo.descripcion)) throw new Error('Falta la descripción de la falla.');
    enLista(nuevo.prioridad, PRIORIDADES, 'Prioridad');
    enLista(nuevo.estado, ESTADOS_MANT, 'Estado de la falla');
    if (datos.listas && datos.listas.tipos_falla) enLista(nuevo.tipo_falla, datos.listas.tipos_falla, 'Tipo de falla');
    exigirFecha(nuevo.fecha_reporte, 'Fecha de reporte');
    if (nuevo.estado === 'RESUELTO') {
      if (!txt(nuevo.quien_intervino)) throw new Error('Para marcarla RESUELTA indicá quién intervino.');
      if (!txt(nuevo.fecha_resolucion)) nuevo.fecha_resolucion = ctx.hoy;
      exigirFecha(nuevo.fecha_resolucion, 'Fecha de resolución');
    } else {
      nuevo.fecha_resolucion = '';
    }
    var hist = actual ? diff(ctx, 'MANTENIMIENTO', nuevo.id_mant, actual, nuevo, CAMPOS_MANT)
      : alta(ctx, 'MANTENIMIENTO', nuevo.id_mant, nuevo.id_local + ' · ' + nuevo.tipo_falla + ' · ' + nuevo.prioridad);
    return { upserts: [{ hoja: 'MANTENIMIENTO', fila: nuevo }], historial: hist, mensaje: actual ? 'Falla actualizada.' : 'Falla registrada.' };
  }

  // Aplica un resultado sobre `datos` en memoria (lo usa el modo demo y el backend antes de responder)
  function aplicar(datos, resultado) {
    (resultado.borrados || []).forEach(function (b) {
      var key = HOJA_A_KEY[b.hoja], clave = CLAVES[b.hoja];
      datos[key] = datos[key].filter(function (f) { return f[clave] !== b.id; });
    });
    resultado.upserts.forEach(function (u) {
      var key = HOJA_A_KEY[u.hoja], clave = CLAVES[u.hoja], arr = datos[key];
      var idx = -1;
      for (var i = 0; i < arr.length; i++) if (arr[i][clave] === u.fila[clave]) { idx = i; break; }
      if (idx >= 0) arr[idx] = u.fila; else arr.push(u.fila);
    });
    resultado.historial.forEach(function (h) { datos.historial.push(h); });
    return datos;
  }

  var ACCIONES = { guardarLocal: guardarLocal, guardarContrato: guardarContrato, generarCuotas: generarCuotas, registrarPago: registrarPago, anularCuota: anularCuota, guardarMantenimiento: guardarMantenimiento };

  return {
    CLAVES: CLAVES, HOJA_A_KEY: HOJA_A_KEY, ACCIONES: ACCIONES,
    ESTADOS_LOCAL: ESTADOS_LOCAL, ESTADOS_CONTRATO: ESTADOS_CONTRATO, ESTADOS_CUOTA: ESTADOS_CUOTA, PRIORIDADES: PRIORIDADES, ESTADOS_MANT: ESTADOS_MANT, CONCEPTOS: CONCEPTOS,
    hoyISO: hoyISO, ahoraISO: ahoraISO, num: num, txt: txt, siguienteId: siguienteId, contratoVigente: contratoVigente, saldoCuota: saldoCuota, aplicar: aplicar,
    ejecutar: function (accion, datos, payload, ctx) {
      if (!ACCIONES[accion]) throw new Error('Acción desconocida: ' + accion);
      return ACCIONES[accion](datos, payload || {}, ctx);
    }
  };
})();
