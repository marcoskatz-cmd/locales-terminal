// ============================================================
//  CONFIG — esquema de la planilla y acceso a Script Properties.
//  Todo lo que la app espera de la planilla está acá; Meta.js lo compara contra la realidad.
// ============================================================
var VERSION_ESQUEMA = 1;

// Encabezados de cada hoja, en orden. El backend referencia columnas por nombre, nunca por número.
var ESQUEMA = {
  LOCALES: ['id_local', 'nombre', 'categoria', 'planta', 'sector', 'zonas', 'm2', 'rubro', 'estado', 'observaciones', 'activo'],
  CONTRATOS: ['id_contrato', 'id_local', 'inquilino', 'cuit', 'contacto', 'fecha_inicio', 'fecha_fin', 'monto_alquiler',
    'indice_ajuste', 'periodicidad_meses', 'proxima_fecha_ajuste', 'deposito', 'expensas_mensuales', 'estado_contrato', 'observaciones'],
  CUOTAS: ['id_cuota', 'id_contrato', 'id_local', 'periodo', 'concepto', 'monto', 'vencimiento', 'estado'],
  PAGOS: ['id_pago', 'id_cuota', 'id_local', 'fecha', 'monto', 'medio', 'comprobante', 'observaciones'],
  MANTENIMIENTO: ['id_mant', 'id_local', 'planta', 'fecha_reporte', 'tipo_falla', 'descripcion', 'prioridad', 'estado',
    'quien_intervino', 'fecha_resolucion', 'costo', 'fotos', 'observaciones'],
  HISTORIAL: ['fecha', 'usuario', 'entidad', 'id', 'campo', 'valor_anterior', 'valor_nuevo'],
};

// Columnas de LISTAS (cada una es un selector de la UI). Se leen por encabezado.
var COLUMNAS_LISTAS = ['categorias', 'rubros', 'sectores', 'indices_ajuste', 'tipos_falla', 'intervinientes', 'medios_pago'];

// Columnas que se guardan como texto plano (fechas AAAA-MM-DD, ids, períodos) para que Sheets no las convierta.
var COLUMNAS_TEXTO = {
  LOCALES: ['id_local', 'zonas'],
  CONTRATOS: ['id_contrato', 'id_local', 'cuit', 'fecha_inicio', 'fecha_fin', 'proxima_fecha_ajuste'],
  CUOTAS: ['id_cuota', 'id_contrato', 'id_local', 'periodo', 'vencimiento'],
  PAGOS: ['id_pago', 'id_cuota', 'id_local', 'fecha'],
  MANTENIMIENTO: ['id_mant', 'id_local', 'fecha_reporte', 'fecha_resolucion'],
  HISTORIAL: ['fecha', 'id'],
};

// Validaciones de datos (desplegables) para que la planilla también sea POKAYOKE si alguien la edita a mano.
var VALIDACIONES = {
  LOCALES: { estado: ['LIBRE', 'ALQUILADO', 'REFACCION', 'JUDICIAL'], planta: 'PLANTAS', categoria: 'categorias', sector: 'sectores' },
  CONTRATOS: { estado_contrato: ['VIGENTE', 'FINALIZADO', 'RESCINDIDO'], indice_ajuste: 'indices_ajuste' },
  CUOTAS: { concepto: ['ALQUILER', 'EXPENSAS'], estado: ['PENDIENTE', 'PARCIAL', 'PAGADA'] },
  PAGOS: { medio: 'medios_pago' },
  MANTENIMIENTO: { prioridad: ['ALTA', 'MEDIA', 'BAJA'], estado: ['PENDIENTE', 'EN CURSO', 'RESUELTO'], tipo_falla: 'tipos_falla', quien_intervino: 'intervinientes' },
};

var PLANTAS = ['PB', 'PA', 'EXT'];   // PB planta baja (con plano), PA oficinas de planta alta, EXT predio norte / exteriores

function prop_(clave, obligatoria) {
  var v = PropertiesService.getScriptProperties().getProperty(clave);
  if (!v && obligatoria) throw new Error('Falta la Script Property ' + clave + '. Corré setupApp() o cargala a mano en Configuración del proyecto.');
  return v;
}
function abrirPlanilla_() {
  return SpreadsheetApp.openById(prop_('APP_SHEET_ID', true));
}
