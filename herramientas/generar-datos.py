# -*- coding: utf-8 -*-
"""Convierte la planilla de relevamiento en los datos que consume el sistema.

  Entrada : docs/Relevamiento locales Terminal.xlsx  (hojas LOCALES, CONTRATOS, CUOTAS, PAGOS, MANTENIMIENTO, LISTAS)
  Salidas : mock/datos.json        -> lo lee la app cuando CONFIG.API_URL está vacío (modo demo)
            backend/MockData.js    -> lo usa setupApp() para sembrar la planilla de Google

Uso: python herramientas/generar-datos.py

Reglas (las mismas que la app):
  - Unidad con fila en CONTRATOS -> contrato VIGENTE; el estado del local queda ALQUILADO salvo que diga JUDICIAL o REFACCION.
    Si al contrato le faltan fechas o monto igual entra, con observación "INCOMPLETO", para que se vea en la app qué falta.
  - se_alquila = NO -> activo = false (no cuenta para ocupación ni deuda).
  - CUOTAS: una por (unidad, período, concepto). PAGOS se imputan a su cuota por esas tres claves; el estado de la
    cuota (PENDIENTE / PARCIAL / PAGADA) se calcula de lo pagado.
  - Si falta una columna o una hoja, se avisa y NO se genera nada.
"""
import json, os, sys, datetime, re
from openpyxl import load_workbook

try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(RAIZ, 'docs', 'Relevamiento locales Terminal.xlsx')
ESPERADAS = {
    'LOCALES': ['id_local', 'categoria', 'planta', 'sector', 'nombre', 'zonas_plano', 'm2', 'rubro', 'estado', 'se_alquila', 'observaciones'],
    'CONTRATOS': ['id_local', 'inquilino', 'cuit', 'contacto', 'fecha_inicio', 'fecha_fin', 'monto_alquiler', 'indice_ajuste', 'periodicidad_meses',
                  'proxima_fecha_ajuste', 'deposito', 'expensas_mensuales', 'observaciones'],
    'CUOTAS': ['id_local', 'periodo', 'concepto', 'monto', 'vencimiento'],
    'PAGOS': ['id_local', 'periodo', 'concepto', 'fecha', 'monto', 'medio', 'comprobante', 'observaciones'],
    'MANTENIMIENTO': ['id_local', 'fecha_reporte', 'tipo_falla', 'descripcion', 'prioridad', 'estado', 'quien_intervino', 'fecha_resolucion', 'costo', 'observaciones'],
    'LISTAS': ['categorias', 'rubros', 'sectores', 'indices_ajuste', 'tipos_falla', 'intervinientes', 'medios_pago'],
}
ESTADOS_LOCAL = ('LIBRE', 'ALQUILADO', 'REFACCION', 'JUDICIAL')

def fecha(v):
    if v in (None, ''): return ''
    if isinstance(v, (datetime.datetime, datetime.date)): return v.strftime('%Y-%m-%d')
    s = str(v).strip()
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m: return f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}'
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s): return s
    raise ValueError(f'Fecha no reconocida: "{s}" (usar dd/mm/aaaa)')
def num(v, defecto=0):
    if v in (None, ''): return defecto
    if isinstance(v, (int, float)): return round(v, 2) if isinstance(v, float) else v
    s = str(v).replace('$', '').replace('.', '').replace(',', '.').strip()
    try: f = float(s); return int(f) if f.is_integer() else round(f, 2)
    except ValueError: raise ValueError(f'Número no reconocido: "{v}"')
def txt(v): return '' if v is None else str(v).strip()
def periodo(v):
    if isinstance(v, (datetime.datetime, datetime.date)): return v.strftime('%Y-%m')
    s = txt(v)
    if re.match(r'^\d{4}-\d{2}$', s): return s
    raise ValueError(f'Período no reconocido: "{s}" (usar AAAA-MM)')

wb = load_workbook(XLSX, data_only=True)
problemas, hojas = [], {}
for nombre, cols in ESPERADAS.items():
    if nombre not in wb.sheetnames: problemas.append(f'Falta la hoja {nombre}'); continue
    ws = wb[nombre]
    enc = [txt(c.value) for c in ws[1]]
    faltan = [c for c in cols if c not in enc]
    if faltan: problemas.append(f'Hoja {nombre}: faltan columnas {faltan}')
    filas = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if all(v in (None, '') for v in r): continue
        filas.append({enc[j]: r[j] for j in range(min(len(enc), len(r))) if enc[j]})
    hojas[nombre] = filas
if problemas:
    print('NO SE GENERÓ NADA. Problemas en la planilla:'); [print(' -', p) for p in problemas]; sys.exit(1)

listas = {k: [txt(f.get(k)) for f in hojas['LISTAS'] if txt(f.get(k))] for k in ESPERADAS['LISTAS']}

# ---------- LOCALES ----------
locales, ids = [], set()
for f in hojas['LOCALES']:
    idl = txt(f['id_local'])
    if not idl: continue
    if idl in ids: problemas.append(f'LOCALES: id_local repetido {idl}'); continue
    ids.add(idl)
    locales.append({
        'id_local': idl, 'nombre': txt(f.get('nombre')) or idl, 'categoria': txt(f.get('categoria')), 'planta': txt(f.get('planta')) or 'PB',
        'sector': txt(f.get('sector')), 'zonas': ';'.join(z.strip() for z in txt(f.get('zonas_plano')).split(';') if z.strip()),
        'm2': num(f.get('m2'), 0), 'rubro': txt(f.get('rubro')), 'estado': txt(f.get('estado')).upper(), 'observaciones': txt(f.get('observaciones')),
        'activo': txt(f.get('se_alquila')).upper() != 'NO',
    })
zonas_vistas = {}
for l in locales:
    for z in l['zonas'].split(';'):
        if z and z in zonas_vistas: problemas.append(f'LOCALES: la zona {z} está asignada a {zonas_vistas[z]} y a {l["id_local"]}')
        if z: zonas_vistas[z] = l['id_local']

# ---------- CONTRATOS ----------
contratos, con_contrato = [], {}
for n, f in enumerate(hojas['CONTRATOS'], 2):
    idl = txt(f['id_local'])
    if not idl: continue
    if idl not in ids: problemas.append(f'CONTRATOS fila {n}: el local {idl} no existe en LOCALES'); continue
    if idl in con_contrato: problemas.append(f'CONTRATOS: el local {idl} tiene más de un contrato'); continue
    try:
        c = {'id_contrato': f'C-{len(contratos) + 1:03d}', 'id_local': idl, 'inquilino': txt(f.get('inquilino')), 'cuit': txt(f.get('cuit')),
             'contacto': txt(f.get('contacto')), 'fecha_inicio': fecha(f.get('fecha_inicio')), 'fecha_fin': fecha(f.get('fecha_fin')),
             'monto_alquiler': num(f.get('monto_alquiler')), 'indice_ajuste': txt(f.get('indice_ajuste')) or 'IPC',
             'periodicidad_meses': int(num(f.get('periodicidad_meses'), 3)), 'proxima_fecha_ajuste': fecha(f.get('proxima_fecha_ajuste')),
             'deposito': num(f.get('deposito')), 'expensas_mensuales': num(f.get('expensas_mensuales')),
             'estado_contrato': 'VIGENTE', 'observaciones': txt(f.get('observaciones'))}
    except ValueError as e:
        problemas.append(f'CONTRATOS fila {n} ({idl}): {e}'); continue
    if not c['inquilino']: problemas.append(f'CONTRATOS fila {n} ({idl}): falta el inquilino'); continue
    faltantes = [k for k in ('fecha_inicio', 'fecha_fin', 'monto_alquiler') if not c[k]]
    if faltantes: c['observaciones'] = ('INCOMPLETO: falta ' + ', '.join(faltantes) + '. ' + c['observaciones']).strip()
    con_contrato[idl] = c['id_contrato']; contratos.append(c)

for l in locales:
    if l['id_local'] in con_contrato:
        if l['estado'] not in ('ALQUILADO', 'JUDICIAL', 'REFACCION'): l['estado'] = 'ALQUILADO'
    else:
        if l['estado'] == 'ALQUILADO': problemas.append(f'LOCALES: {l["id_local"]} figura ALQUILADO pero no tiene fila en CONTRATOS'); l['estado'] = 'LIBRE'
        if not l['estado']: l['estado'] = 'LIBRE'
    if l['estado'] not in ESTADOS_LOCAL: problemas.append(f'LOCALES: estado inválido "{l["estado"]}" en {l["id_local"]}'); l['estado'] = 'LIBRE'

# ---------- CUOTAS ----------
cuotas, idx_cuota = [], {}
for n, f in enumerate(hojas['CUOTAS'], 2):
    idl = txt(f['id_local'])
    if not idl: continue
    if idl not in ids: problemas.append(f'CUOTAS fila {n}: el local {idl} no existe'); continue
    try:
        per, concepto, monto, venc = periodo(f.get('periodo')), (txt(f.get('concepto')).upper() or 'ALQUILER'), num(f.get('monto')), fecha(f.get('vencimiento'))
    except ValueError as e:
        problemas.append(f'CUOTAS fila {n} ({idl}): {e}'); continue
    if concepto not in ('ALQUILER', 'EXPENSAS'): problemas.append(f'CUOTAS fila {n} ({idl}): concepto inválido "{concepto}"'); continue
    clave = (idl, per, concepto)
    if clave in idx_cuota: problemas.append(f'CUOTAS fila {n}: cuota repetida {idl} {per} {concepto} (se suma)'); cuotas[idx_cuota[clave]]['monto'] += monto; continue
    q = {'id_cuota': f'Q-{len(cuotas) + 1:04d}', 'id_contrato': con_contrato.get(idl, ''), 'id_local': idl, 'periodo': per, 'concepto': concepto,
         'monto': monto, 'vencimiento': venc or f'{per}-10', 'estado': 'PENDIENTE'}
    idx_cuota[clave] = len(cuotas); cuotas.append(q)

# ---------- PAGOS ----------
pagos, pagado = [], {}
for n, f in enumerate(hojas['PAGOS'], 2):
    idl = txt(f['id_local'])
    if not idl: continue
    try:
        per, concepto, fch, monto = periodo(f.get('periodo')), (txt(f.get('concepto')).upper() or 'ALQUILER'), fecha(f.get('fecha')), num(f.get('monto'))
    except ValueError as e:
        problemas.append(f'PAGOS fila {n} ({idl}): {e}'); continue
    clave = (idl, per, concepto)
    if clave not in idx_cuota: problemas.append(f'PAGOS fila {n}: no hay cuota {idl} {per} {concepto} para imputar este pago'); continue
    if not (monto > 0): continue
    q = cuotas[idx_cuota[clave]]
    obs = txt(f.get('observaciones'))
    if not fch: fch = q['vencimiento']; obs = (obs + ' · fecha estimada (sin fecha en la planilla)').strip(' ·')
    medio = txt(f.get('medio')).upper() or 'TRANSFERENCIA'
    if medio not in listas['medios_pago']: problemas.append(f'PAGOS fila {n}: medio "{medio}" no está en LISTAS');
    pagos.append({'id_pago': f'P-{len(pagos) + 1:04d}', 'id_cuota': q['id_cuota'], 'id_local': idl, 'fecha': fch, 'monto': monto, 'medio': medio,
                  'comprobante': txt(f.get('comprobante')), 'observaciones': obs})
    pagado[q['id_cuota']] = pagado.get(q['id_cuota'], 0) + monto
for q in cuotas:
    p = pagado.get(q['id_cuota'], 0)
    q['estado'] = 'PAGADA' if p >= q['monto'] - 1 else ('PARCIAL' if p > 0 else 'PENDIENTE')

# ---------- MANTENIMIENTO ----------
mant = []
for n, f in enumerate(hojas['MANTENIMIENTO'], 2):
    idl = txt(f['id_local'])
    if not idl: continue
    if idl != 'COMUN' and idl not in ids: problemas.append(f'MANTENIMIENTO fila {n}: el local {idl} no existe'); continue
    try:
        m = {'id_mant': f'M-{len(mant) + 1:03d}', 'id_local': idl, 'planta': 'PB', 'fecha_reporte': fecha(f.get('fecha_reporte')) or datetime.date.today().isoformat(),
             'tipo_falla': txt(f.get('tipo_falla')) or 'OTRO', 'descripcion': txt(f.get('descripcion')), 'prioridad': txt(f.get('prioridad')).upper() or 'MEDIA',
             'estado': txt(f.get('estado')).upper() or 'PENDIENTE', 'quien_intervino': txt(f.get('quien_intervino')), 'fecha_resolucion': fecha(f.get('fecha_resolucion')),
             'costo': num(f.get('costo'), ''), 'fotos': '', 'observaciones': txt(f.get('observaciones'))}
    except ValueError as e:
        problemas.append(f'MANTENIMIENTO fila {n}: {e}'); continue
    mant.append(m)

if problemas:
    print('AVISOS (se generó igual, pero conviene corregir):'); [print(' -', p) for p in problemas]

datos = {'generado': datetime.date.today().isoformat(), 'origen': os.path.basename(XLSX), 'listas': listas, 'locales': locales, 'contratos': contratos,
         'cuotas': cuotas, 'pagos': pagos, 'mantenimiento': mant, 'historial': []}
with open(os.path.join(RAIZ, 'mock', 'datos.json'), 'w', encoding='utf-8') as fh: json.dump(datos, fh, ensure_ascii=False, indent=1)
with open(os.path.join(RAIZ, 'backend', 'MockData.js'), 'w', encoding='utf-8') as fh:
    fh.write('// GENERADO por herramientas/generar-datos.py desde "' + os.path.basename(XLSX) + '" — NO editar a mano.\n'
             '// Lo usa setupApp() para sembrar la planilla de Google. Regenerar cada vez que cambie el relevamiento.\n'
             'const MOCK = ' + json.dumps(datos, ensure_ascii=False, indent=1) + ';\n')
hoy = datetime.date.today().isoformat()
deuda = sum(q['monto'] - pagado.get(q['id_cuota'], 0) for q in cuotas if q['estado'] != 'PAGADA' and q['vencimiento'] < hoy)
print(f'OK → mock/datos.json y backend/MockData.js')
print(f'  locales={len(locales)} (activos {sum(1 for l in locales if l["activo"])}, con zona {sum(1 for l in locales if l["zonas"])}) · contratos={len(contratos)} '
      f'(incompletos {sum(1 for c in contratos if c["observaciones"].startswith("INCOMPLETO"))}) · cuotas={len(cuotas)} · pagos={len(pagos)} · mantenimiento={len(mant)}')
print(f'  deuda vencida al {hoy}: $ {deuda:,.0f}'.replace(',', '.'))
