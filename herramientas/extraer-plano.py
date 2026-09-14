# -*- coding: utf-8 -*-
"""Extrae del PDF "CONFORME A OBRA 2026" todo lo que el sistema necesita del plano:

  1. planos/planta-baja.png          fondo del mapa (recorte de la franja de locales, 200 dpi)
  2. planos/planta-baja.svg          <image> del fondo + una zona <rect id="L-XX" class="zona"> por local
  3. herramientas/plano-locales.json etiquetas detectadas: id, nombre en plano, sector, caja (pt PDF)
  4. scratchpad/debug-zonas.png      (opcional, --debug) plano con las cajas dibujadas para revisar

Uso:  python herramientas/extraer-plano.py "C:\\ruta\\CONFORME A OBRA 2026.pdf" [--debug]

Cómo detecta cada local: toma cada etiqueta numérica del PDF (6.1 pt, ej. "23 a 25", "518b") y lanza rayos
hacia los 4 lados hasta la primera pared (segmento vectorial del PDF). El texto que está justo debajo de la
etiqueta es el nombre del inquilino ("VACÍO" = libre). Si un rayo se escapa (puerta abierta), se acota a un
tamaño máximo razonable. Las cajas se pueden corregir a mano en el SVG después: solo importa el id.
"""
import fitz, re, json, sys, os, unicodedata
try: sys.stdout.reconfigure(encoding='utf-8')
except Exception: pass

if len(sys.argv) < 2:
    print(__doc__); sys.exit(1)
PDF = sys.argv[1]
DEBUG = '--debug' in sys.argv
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- Región del plano que interesa (pt PDF). El resto es estacionamiento y andenes.
RECORTE = fitz.Rect(150, 250, 1510, 575)
DPI = 200

# --- Sectores (BLOCKs) según el plano. Fila norte / fila sur separadas por y=415.
# Coordenadas del rótulo "BLOCK n" medidas sobre el plano (pt PDF).
SECTORES_NORTE = [('B8', 'Block 8', 280), ('B1', 'Block 1', 519), ('B2', 'Block 2', 779), ('B3', 'Block 3', 1031), ('B4', 'Block 4', 1319)]
SECTORES_SUR = [('B8', 'Block 8', 280), ('B7', 'Block 7', 519), ('B6', 'Block 6', 1023), ('B5', 'Block 5', 1368)]
Y_DIVISION = 415

# --- Límites de tamaño de una zona (pt). Si el rayo va más lejos, se corta.
MAX_ANCHO, MAX_ALTO, MIN_LADO = 90, 70, 6
MIN_SEG = 2.5     # segmentos más cortos se ignoran (hatch, puntos)

doc = fitz.open(PDF)
pag = doc[0]

# ---------- 1. Texto ----------
spans = []
for b in pag.get_text('dict')['blocks']:
    if b['type'] != 0: continue
    for l in b['lines']:
        for s in l['spans']:
            t = s['text'].strip()
            if t: spans.append({'t': t, 'bbox': fitz.Rect(s['bbox']), 'size': round(s['size'], 1)})

RE_ID = re.compile(r'^\d{1,3}[abcd]?(\s*(&|-|a)\s*\d{1,3}[abcd]?)?(\s*&\s*\d+)?$', re.I)
RE_ID_ESPECIAL = re.compile(r'^\d{1,3}[abcd]?&[abcd]\s*-\s*\d{1,3}[abcd]?&[abcd]$', re.I)  # "75b&a - 74b&a"
RE_ID_LETRAS = re.compile(r'^\d{1,3}[abcd]&[abcd]$', re.I)                                 # "10a&b"
def es_id(t): return bool(RE_ID.match(t) or RE_ID_ESPECIAL.match(t) or RE_ID_LETRAS.match(t) or t in ('1A', '1B'))

# Algunos rótulos vienen pegados en un solo texto ("63-64 65-66", "37-38 39-40"): se parten en proporción al ancho
def partir_span(s):
    t = s['t']
    if es_id(t) or RE_ID_ESPECIAL.match(t): return [s]
    partes = t.split()
    if len(partes) >= 2 and all(es_id(x) for x in partes):
        r = s['bbox']; total = sum(len(x) for x in partes) + (len(partes) - 1)
        out, pos = [], 0
        for x in partes:
            x0 = r.x0 + r.width * pos / total; x1 = r.x0 + r.width * (pos + len(x)) / total
            out.append({'t': x, 'bbox': fitz.Rect(x0, r.y0, x1, r.y1), 'size': s['size']}); pos += len(x) + 1
        return out
    return [s]
spans = [q for s in spans for q in partir_span(s)]

etiquetas = [s for s in spans if es_id(s['t']) and RECORTE.contains(s['bbox'].tl)]
otros = [s for s in spans if not es_id(s['t']) and RECORTE.contains(s['bbox'].tl)]

# ---------- 2. Segmentos (paredes) ----------
H, V = [], []   # horizontales (y, x0, x1) / verticales (x, y0, y1)
for d in pag.get_drawings():
    for it in d['items']:
        segs = []
        if it[0] == 'l':
            segs.append((it[1], it[2]))
        elif it[0] == 're':
            r = it[1]; segs += [(r.tl, r.tr), (r.tr, r.br), (r.br, r.bl), (r.bl, r.tl)]
        for a, b in segs:
            if not (RECORTE.contains(a) or RECORTE.contains(b)): continue
            dx, dy = abs(a.x - b.x), abs(a.y - b.y)
            if dx < 0.6 and dy >= MIN_SEG: V.append((a.x, min(a.y, b.y), max(a.y, b.y)))
            elif dy < 0.6 and dx >= MIN_SEG: H.append((a.y, min(a.x, b.x), max(a.x, b.x)))
print(f'{len(etiquetas)} etiquetas · {len(H)} seg. horizontales · {len(V)} verticales')

def rayo(cx, cy, direccion):
    """Distancia desde (cx,cy) hasta la primera pared en la dirección dada. Toma 3 rayos paralelos y usa la mediana."""
    res = []
    for off in (-1.5, 0, 1.5):
        mejor = None
        if direccion in ('izq', 'der'):
            y = cy + off
            for x, y0, y1 in V:
                if y0 - 0.3 <= y <= y1 + 0.3:
                    if direccion == 'der' and x > cx + 0.5: mejor = x if mejor is None else min(mejor, x)
                    if direccion == 'izq' and x < cx - 0.5: mejor = x if mejor is None else max(mejor, x)
        else:
            x = cx + off
            for y, x0, x1 in H:
                if x0 - 0.3 <= x <= x1 + 0.3:
                    if direccion == 'abajo' and y > cy + 0.5: mejor = y if mejor is None else min(mejor, y)
                    if direccion == 'arriba' and y < cy - 0.5: mejor = y if mejor is None else max(mejor, y)
        if mejor is not None: res.append(mejor)
    if not res: return None
    res.sort(); return res[len(res) // 2]

def normalizar_id(t):
    t = t.replace(' ', '')
    t = re.sub(r'(?i)a(?=\d)', '-', t) if re.match(r'^\d+a\d+$', t, re.I) else t   # "23a25" -> "23-25"
    return 'L-' + t.upper()

def quitar_acentos(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

def texto_bajo(et):
    """Líneas de texto no numérico justo debajo (o pegadas) de la etiqueta: el nombre del inquilino."""
    r = et['bbox']
    cand = []
    for o in otros:
        ob = o['bbox']; ocx = (ob.x0 + ob.x1) / 2
        # alineado con la etiqueta: el centro del texto cae dentro del ancho de la etiqueta (con 3 pt de margen)
        if ob.y0 >= r.y0 - 1 and ob.y0 <= r.y1 + 14 and (r.x0 - 3 <= ocx <= r.x1 + 3):
            cand.append(o)
    cand.sort(key=lambda o: o['bbox'].y0)
    partes, ultimo_y = [], None
    for o in cand:
        if ultimo_y is not None and o['bbox'].y0 - ultimo_y > 9: break
        partes.append(o['t']); ultimo_y = o['bbox'].y0
    return ' '.join(partes).strip()

def sector_de(cx, cy):
    lista = SECTORES_NORTE if cy < Y_DIVISION else SECTORES_SUR
    return min(lista, key=lambda s: abs(s[2] - cx))

locales, usados = [], set()
for et in sorted(etiquetas, key=lambda e: (e['bbox'].y0, e['bbox'].x0)):
    r = et['bbox']; cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
    idl = normalizar_id(et['t'])
    if idl in usados:  # etiqueta repetida en el plano (ej. dos "22"): se numera
        n = 2
        while f'{idl}_{n}' in usados: n += 1
        idl = f'{idl}_{n}'
    usados.add(idl)
    izq, der = rayo(cx, cy, 'izq'), rayo(cx, cy, 'der')
    arr, aba = rayo(cx, cy, 'arriba'), rayo(cx, cy, 'abajo')
    # Fallbacks y topes
    ancho_def, alto_def = 22, 18
    if izq is None or cx - izq > MAX_ANCHO / 2: izq = cx - ancho_def / 2
    if der is None or der - cx > MAX_ANCHO / 2: der = cx + ancho_def / 2
    if arr is None or cy - arr > MAX_ALTO / 2: arr = cy - alto_def / 2
    if aba is None or aba - cy > MAX_ALTO / 2: aba = cy + alto_def / 2
    if der - izq < MIN_LADO: izq, der = cx - ancho_def / 2, cx + ancho_def / 2
    if aba - arr < MIN_LADO: arr, aba = cy - alto_def / 2, cy + alto_def / 2
    nombre = texto_bajo(et)
    sec = sector_de(cx, cy)
    locales.append({
        'id_local': idl, 'etiqueta_plano': et['t'], 'nombre_en_plano': nombre,
        'sector': sec[0], 'sector_nombre': sec[1],
        'estado_deducido': 'LIBRE' if quitar_acentos(nombre).upper().startswith('VACIO') else ('A CONFIRMAR' if nombre == '' else 'ALQUILADO'),
        'caja': [round(izq, 1), round(arr, 1), round(der - izq, 1), round(aba - arr, 1)],
        'centro': [round(cx, 1), round(cy, 1)],
    })

# ---------- 3. Salidas ----------
os.makedirs(os.path.join(RAIZ, 'planos'), exist_ok=True)
pix = pag.get_pixmap(dpi=DPI, clip=RECORTE)
png = os.path.join(RAIZ, 'planos', 'planta-baja.png')
pix.save(png)
print(f'fondo: {png} {pix.width}x{pix.height}px')

# SVG en coordenadas pt del PDF (viewBox = RECORTE) para que las cajas coincidan con el fondo
W, Hh = RECORTE.width, RECORTE.height
zonas = []
for l in locales:
    x, y, w, h = l['caja']
    zonas.append(f'  <rect id="{l["id_local"]}" class="zona" x="{x}" y="{y}" width="{w}" height="{h}"><title>{l["etiqueta_plano"]}</title></rect>')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="{RECORTE.x0} {RECORTE.y0} {W} {Hh}" font-family="system-ui, sans-serif">
  <!-- GENERADO por herramientas/extraer-plano.py a partir de "CONFORME A OBRA 2026.pdf".
       Fondo: planta-baja.png (recorte {RECORTE}). Coordenadas en puntos del PDF.
       Cada local es un <rect id="L-XX" class="zona">; se pueden ajustar x/y/width/height a mano sin tocar nada más. -->
  <defs>
    <pattern id="rayado" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="#bfdbfe"/>
      <line x1="0" y1="0" x2="0" y2="6" stroke="#3b82f6" stroke-width="2.5"/>
    </pattern>
  </defs>
  <image href="planos/planta-baja.png" x="{RECORTE.x0}" y="{RECORTE.y0}" width="{W}" height="{Hh}" preserveAspectRatio="none"/>
''' + '\n'.join(zonas) + '\n</svg>\n'
with open(os.path.join(RAIZ, 'planos', 'planta-baja.svg'), 'w', encoding='utf-8') as f: f.write(svg)

json.dump({'fuente': os.path.basename(PDF), 'recorte': list(RECORTE), 'locales': locales},
          open(os.path.join(RAIZ, 'herramientas', 'plano-locales.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{len(locales)} locales → herramientas/plano-locales.json y planos/planta-baja.svg')
por_sector = {}
for l in locales: por_sector[l['sector_nombre']] = por_sector.get(l['sector_nombre'], 0) + 1
print('por sector:', por_sector)
print('estados:', {e: sum(1 for l in locales if l['estado_deducido'] == e) for e in ('ALQUILADO', 'LIBRE', 'A CONFIRMAR')})

if DEBUG:
    esc = DPI / 72
    img = fitz.open()
    p2 = img.new_page(width=pix.width, height=pix.height)
    p2.insert_image(p2.rect, pixmap=pix)
    for l in locales:
        x, y, w, h = l['caja']
        rr = fitz.Rect((x - RECORTE.x0) * esc, (y - RECORTE.y0) * esc, (x + w - RECORTE.x0) * esc, (y + h - RECORTE.y0) * esc)
        color = {'ALQUILADO': (0.85, 0.35, 0), 'LIBRE': (0, 0.45, 0.4)}.get(l['estado_deducido'], (0.4, 0.2, 0.7))
        p2.draw_rect(rr, color=color, width=2, fill=color, fill_opacity=0.25)
    out = sys.argv[sys.argv.index('--debug') + 1] if len(sys.argv) > sys.argv.index('--debug') + 1 else os.path.join(RAIZ, 'herramientas', 'debug-zonas.png')
    p2.get_pixmap(dpi=72).save(out)
    print('debug:', out)
