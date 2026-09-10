# -*- coding: utf-8 -*-
"""Genera los datos ficticios en dos formatos idénticos:
   - mock/datos.json        -> lo lee el frontend cuando CONFIG.API_URL está vacío
   - backend/MockData.js    -> lo usa setupApp() para sembrar la planilla

Correr desde la raíz del repo:  python herramientas/generar-mock.py
Cuando lleguen los datos reales este archivo y sus salidas se borran.
"""
import json, os
from datetime import date, timedelta

HOY = date(2026, 9, 10)
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def d(dd): return dd.isoformat()
def dias(n): return d(HOY + timedelta(days=n))

LISTAS = {
    "rubros": ["Kiosco", "Cafetería", "Comidas rápidas", "Farmacia", "Indumentaria", "Librería",
               "Supermercado", "Regalería", "Servicios", "Otro"],
    "sectores": ["Hall central", "Ala norte", "Ala sur", "Andenes", "Entrepiso"],
    "indices_ajuste": ["IPC", "ICL", "% FIJO", "OTRO"],
    "tipos_falla": ["ELÉCTRICA", "SANITARIA", "ESTRUCTURAL", "PINTURA", "CERRAJERÍA", "CLIMATIZACIÓN", "OTRO"],
    "intervinientes": ["Personal INGECO", "Electricista Gómez", "Refrigeración Díaz", "Albañil Ruiz", "Otro"],
    "medios_pago": ["TRANSFERENCIA", "EFECTIVO", "CHEQUE"],
}

LOCALES = [
    # id, nombre, planta, sector, m2, rubro, estado, obs
    ("L-01", "Local 1",  "PB", "Hall central", 45,  "Kiosco",          "ALQUILADO", ""),
    ("L-02", "Local 2",  "PB", "Hall central", 60,  "Cafetería",       "ALQUILADO", ""),
    ("L-03", "Local 3",  "PB", "Ala norte",    30,  "",                "LIBRE",     "Disponible desde enero 2026"),
    ("L-04", "Local 4",  "PB", "Ala norte",    80,  "Farmacia",        "ALQUILADO", ""),
    ("L-05", "Local 5",  "PB", "Ala sur",      25,  "",                "REFACCION", "Se renueva instalación eléctrica"),
    ("L-06", "Local 6",  "PB", "Andenes",      120, "Comidas rápidas", "ALQUILADO", ""),
    ("L-07", "Local 7",  "PA", "Entrepiso",    40,  "Indumentaria",    "ALQUILADO", ""),
    ("L-08", "Local 8",  "PA", "Entrepiso",    40,  "",                "LIBRE",     ""),
    ("L-09", "Local 9",  "PA", "Entrepiso",    55,  "Librería",        "ALQUILADO", ""),
    ("L-10", "Local 10", "PA", "Entrepiso",    200, "Supermercado",    "ALQUILADO", ""),
]

CONTRATOS = [
    # id, local, inquilino, cuit, contacto, inicio, fin, monto, indice, period, prox_ajuste, deposito, expensas, estado
    ("C-001", "L-01", "Kiosco El Andén S.R.L.",    "30-71234567-8", "Juan Pérez · 381 555-0101",     "2025-03-01", "2028-02-29", 450000,  "IPC",    3, "2026-12-01", 900000,  60000,  "VIGENTE"),
    ("C-002", "L-02", "Café del Viajero",          "27-28123456-3", "Ana Ledesma · 381 555-0202",    "2024-06-01", "2027-05-31", 600000,  "ICL",    4, "2026-10-01", 1200000, 80000,  "VIGENTE"),
    ("C-003", "L-04", "Farmacia Central S.A.",     "30-65432109-1", "Dr. Ríos · 381 555-0303",       "2023-11-01", dias(45),     800000,  "IPC",    3, "2026-11-01", 1600000, 100000, "VIGENTE"),
    ("C-004", "L-06", "Rápido y Rico S.A.",        "30-70987654-2", "Carla Ibáñez · 381 555-0404",   "2025-01-15", "2027-01-14", 1200000, "IPC",    3, "2026-10-15", 2400000, 150000, "VIGENTE"),
    ("C-005", "L-07", "Indumentaria Norte",        "20-33445566-7", "Pablo Sosa · 381 555-0505",     "2026-02-01", "2029-01-31", 500000,  "ICL",    4, dias(15),     1000000, 55000,  "VIGENTE"),
    ("C-006", "L-09", "Librería Tucumán",          "27-30111222-9", "Marta Juárez · 381 555-0606",   "2025-08-01", "2027-07-31", 550000,  "% FIJO", 6, "2027-02-01", 1100000, 70000,  "VIGENTE"),
    ("C-007", "L-10", "Supermercado La Estación",  "30-60555444-6", "Gerencia · 381 555-0707",       "2022-12-01", dias(80),     2500000, "IPC",    3, "2026-12-01", 5000000, 300000, "VIGENTE"),
    ("C-008", "L-03", "Regalería Sol",             "27-25999888-4", "Lucía Paz · 381 555-0808",      "2023-01-01", "2025-12-31", 300000,  "IPC",    3, "",           600000,  40000,  "FINALIZADO"),
]

# Qué cuotas quedan impagas por local (periodo, concepto) y pagos parciales
IMPAGAS = {
    "L-02": {("2026-07", "ALQUILER"), ("2026-08", "ALQUILER"), ("2026-08", "EXPENSAS")},
    "L-06": {("2026-06", "ALQUILER"), ("2026-07", "ALQUILER"), ("2026-08", "ALQUILER"),
             ("2026-06", "EXPENSAS"), ("2026-07", "EXPENSAS"), ("2026-08", "EXPENSAS")},
}
PARCIALES = {("L-09", "2026-08", "ALQUILER"): 300000}

PERIODOS = ["2026-06", "2026-07", "2026-08", "2026-09"]

cuotas, pagos = [], []
nc = np = 0
for c in CONTRATOS:
    (idc, idl, _, _, _, _, _, monto, _, _, _, _, exp, est) = c
    if est != "VIGENTE":
        continue
    for per in PERIODOS:
        for concepto, m in (("ALQUILER", monto), ("EXPENSAS", exp)):
            nc += 1
            idq = f"Q-{nc:04d}"
            venc = f"{per}-10"
            estado = "PENDIENTE"
            pagado = 0
            if per == "2026-09":
                estado = "PENDIENTE"                       # vence hoy, todavía no es deuda
            elif (per, concepto) in IMPAGAS.get(idl, set()):
                estado = "PENDIENTE"
            elif (idl, per, concepto) in PARCIALES:
                estado = "PARCIAL"; pagado = PARCIALES[(idl, per, concepto)]
            else:
                estado = "PAGADA"; pagado = m
            cuotas.append({"id_cuota": idq, "id_contrato": idc, "id_local": idl, "periodo": per,
                           "concepto": concepto, "monto": m, "vencimiento": venc, "estado": estado})
            if pagado:
                np += 1
                y, mo = per.split("-")
                pagos.append({"id_pago": f"P-{np:04d}", "id_cuota": idq, "id_local": idl,
                              "fecha": f"{per}-{'08' if concepto == 'ALQUILER' else '09'}",
                              "monto": pagado, "medio": "TRANSFERENCIA" if np % 3 else "EFECTIVO",
                              "comprobante": f"TR-{np:05d}", "observaciones": ""})

MANT = [
    ("M-001", "L-05", "PB", "2026-08-20", "ELÉCTRICA",     "Tablero quemado, sin suministro en el local",  "ALTA",  "EN CURSO",  "Electricista Gómez", "",           "",     ""),
    ("M-002", "L-05", "PB", "2026-08-22", "PINTURA",       "Repintado completo posterior a la refacción",  "MEDIA", "PENDIENTE", "",                   "",           "",     ""),
    ("M-003", "L-06", "PB", "2026-09-02", "SANITARIA",     "Pérdida de agua en bacha de cocina",           "MEDIA", "PENDIENTE", "",                   "",           "",     ""),
    ("M-004", "L-08", "PA", "2026-07-15", "CERRAJERÍA",    "Cerradura de persiana trabada",                "BAJA",  "PENDIENTE", "",                   "",           "",     ""),
    ("M-005", "L-02", "PB", "2026-05-10", "CLIMATIZACIÓN", "Split del salón no enfría",                    "MEDIA", "RESUELTO",  "Refrigeración Díaz", "2026-05-14", 85000,  "Carga de gas y cambio de capacitor"),
    ("M-006", "COMUN","PA", "2026-09-05", "ELÉCTRICA",     "Luminaria del pasillo de planta alta quemada", "BAJA",  "PENDIENTE", "",                   "",           "",     "Pasillo frente a Local 8"),
    ("M-007", "L-01", "PB", "2026-03-03", "ESTRUCTURAL",   "Fisura en revoque de pared lateral",           "BAJA",  "RESUELTO",  "Albañil Ruiz",       "2026-03-20", 40000,  ""),
]

HISTORIAL = [
    ("2026-08-19 10:12", "admin", "LOCALES",       "L-05",  "estado",        "ALQUILADO", "REFACCION"),
    ("2026-08-20 09:40", "admin", "MANTENIMIENTO", "M-001", "(alta)",        "",          "ELÉCTRICA · ALTA"),
    ("2026-09-02 16:05", "admin", "MANTENIMIENTO", "M-003", "(alta)",        "",          "SANITARIA · MEDIA"),
    ("2026-09-09 11:30", "admin", "PAGOS",         "P-0001","(alta)",        "",          "Q-0001 · 450000"),
]

def objs(campos, filas): return [dict(zip(campos, f)) for f in filas]

datos = {
    "generado": d(HOY),
    "listas": LISTAS,
    "locales": objs(["id_local","nombre","planta","sector","m2","rubro","estado","observaciones"], LOCALES),
    "contratos": objs(["id_contrato","id_local","inquilino","cuit","contacto","fecha_inicio","fecha_fin",
                       "monto_alquiler","indice_ajuste","periodicidad_meses","proxima_fecha_ajuste",
                       "deposito","expensas_mensuales","estado_contrato"], CONTRATOS),
    "cuotas": cuotas,
    "pagos": pagos,
    "mantenimiento": objs(["id_mant","id_local","planta","fecha_reporte","tipo_falla","descripcion","prioridad",
                           "estado","quien_intervino","fecha_resolucion","costo","observaciones"], MANT),
    "historial": objs(["fecha","usuario","entidad","id","campo","valor_anterior","valor_nuevo"], HISTORIAL),
}
for l in datos["locales"]: l["activo"] = True
for c in datos["contratos"]: c["observaciones"] = ""
for m in datos["mantenimiento"]: m["fotos"] = ""

with open(os.path.join(RAIZ, "mock", "datos.json"), "w", encoding="utf-8") as f:
    json.dump(datos, f, ensure_ascii=False, indent=1)

js = ("// GENERADO por herramientas/generar-mock.py — NO editar a mano.\n"
      "// Datos ficticios para setupApp(). Borrar este archivo cuando se carguen los datos reales.\n"
      "const MOCK = " + json.dumps(datos, ensure_ascii=False, indent=1) + ";\n")
with open(os.path.join(RAIZ, "backend", "MockData.js"), "w", encoding="utf-8") as f:
    f.write(js)

print(f"locales={len(datos['locales'])} contratos={len(CONTRATOS)} cuotas={len(cuotas)} pagos={len(pagos)} mant={len(MANT)}")
