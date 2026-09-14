// ============================================================
//  APP — mapa, ficha, dashboard, alertas, formularios.
//  No conoce si los datos vienen del mock o de Apps Script (eso lo resuelve api.js).
// ============================================================
(function () {
  'use strict';

  var D = null;                 // datos: {locales, contratos, cuotas, pagos, mantenimiento, historial, listas}
  var plantaActual = CONFIG.PLANTAS[0].id;
  var sectorActual = 'TODO';    // 'TODO' o un valor de CONFIG.SECTORES
  var vistaBase = null;         // viewBox completo del SVG [x, y, w, h]
  var vistaSector = null;       // viewBox de la vista actual (sector o todo), a donde vuelve ⌂
  var localSel = null;
  var tabFicha = 'resumen';
  var filtroEstado = 'todos';
  var filtroCategoria = '';
  var textoBusqueda = '';
  var svgCache = {};
  var zonaALocal = {};          // id de zona del SVG -> id_local (una unidad puede tener varias zonas)

  function zonasDe(l) { return String(l.zonas || '').split(';').map(function (z) { return z.trim(); }).filter(Boolean); }
  function reindexarZonas() {
    zonaALocal = {};
    D.locales.forEach(function (l) { zonasDe(l).forEach(function (z) { zonaALocal[z] = l.id_local; }); });
    // Compatibilidad: si una unidad no declara zonas pero existe una zona con su mismo id, se usa
    D.locales.forEach(function (l) { if (!zonasDe(l).length && !zonaALocal[l.id_local]) zonaALocal[l.id_local] = l.id_local; });
  }
  function localDeZona(idZona) { var id = zonaALocal[idZona]; return id ? D.locales.filter(function (x) { return x.id_local === id; })[0] : null; }
  function tienePlano(planta) { return CONFIG.PLANTAS.some(function (p) { return p.id === planta; }); }

  var $ = function (id) { return document.getElementById(id); };
  var HOY = REGLAS.hoyISO();

  // ---------- utilidades ----------
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtMonto(n) { n = REGLAS.num(n); return '$ ' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 }); }
  function fmtFecha(iso) { if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '—'; var p = iso.slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fmtPeriodo(per) { var m = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']; var p = per.split('-'); return m[parseInt(p[1], 10) - 1] + ' ' + p[0]; }
  function diasHasta(iso) { if (!iso) return null; var a = new Date(HOY + 'T00:00:00'), b = new Date(iso + 'T00:00:00'); return Math.round((b - a) / 86400000); }
  function periodoActual() { return HOY.slice(0, 7); }
  function opciones(lista, sel, vacio) {
    var h = vacio !== undefined ? '<option value="">' + esc(vacio) + '</option>' : '';
    (lista || []).forEach(function (o) { h += '<option value="' + esc(o) + '"' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; });
    return h;
  }
  function toast(msg, esError) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (esError ? ' error' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, esError ? 5000 : 2800);
  }
  function nombrePlanta(id) { var p = CONFIG.PLANTAS.filter(function (x) { return x.id === id; })[0]; return p ? p.nombre : id; }

  // ---------- cálculo de estado (nunca se carga a mano) ----------
  function resumenLocal(l) {
    var vig = REGLAS.contratoVigente(D, l.id_local);
    var cuotas = D.cuotas.filter(function (q) { return q.id_local === l.id_local; });
    var deuda = { ALQUILER: { meses: 0, monto: 0 }, EXPENSAS: { meses: 0, monto: 0 } };
    var vencidas = [];
    cuotas.forEach(function (q) {
      if (q.estado === 'PAGADA') return;
      if (q.vencimiento < HOY) {
        var s = REGLAS.saldoCuota(D, q);
        deuda[q.concepto].meses++; deuda[q.concepto].monto += s; vencidas.push(q);
      }
    });
    var mantPend = D.mantenimiento.filter(function (m) { return m.id_local === l.id_local && m.estado !== 'RESUELTO'; });
    var estadoVisual = l.activo === false ? 'inactivo' : l.estado === 'REFACCION' ? 'refaccion' : l.estado === 'JUDICIAL' ? 'judicial' : l.estado === 'LIBRE' ? 'libre' : (vencidas.length ? 'deuda' : 'aldia');
    var totalDeuda = deuda.ALQUILER.monto + deuda.EXPENSAS.monto;
    return { contrato: vig, deuda: deuda, totalDeuda: totalDeuda, vencidas: vencidas, mantPend: mantPend, estadoVisual: estadoVisual,
      contratoIncompleto: !!vig && (!vig.fecha_fin || !REGLAS.num(vig.monto_alquiler)),
      diasVenc: vig && vig.fecha_fin ? diasHasta(vig.fecha_fin) : null, diasAjuste: vig && vig.proxima_fecha_ajuste ? diasHasta(vig.proxima_fecha_ajuste) : null };
  }
  var NOMBRE_ESTADO = { libre: 'Libre', aldia: 'Alquilado · al día', deuda: 'Alquilado · con deuda', refaccion: 'En refacción', judicial: 'En gestión judicial', inactivo: 'Uso interno (no se alquila)', sindatos: 'Zona sin unidad asignada' };
  function etiquetaCorta(l) { return String(l.nombre || l.id_local).replace(/^local\s+/i, ''); }

  function localesFiltrados() {
    var t = textoBusqueda.toLowerCase();
    return D.locales.map(function (l) { return { l: l, r: resumenLocal(l) }; }).filter(function (x) {
      if (sectorActual !== 'TODO' && x.l.sector !== sectorActual) return false;
      if (filtroCategoria && x.l.categoria !== filtroCategoria) return false;
      if (filtroEstado === 'mant' && !x.r.mantPend.length) return false;
      if (['libre', 'aldia', 'deuda', 'refaccion', 'judicial', 'inactivo'].indexOf(filtroEstado) >= 0 && x.r.estadoVisual !== filtroEstado) return false;
      if (t) {
        var blob = [x.l.id_local, x.l.nombre, x.l.rubro, x.l.sector, x.l.categoria, x.l.zonas, x.r.contrato ? x.r.contrato.inquilino : ''].join(' ').toLowerCase();
        if (blob.indexOf(t) < 0) return false;
      }
      return true;
    });
  }

  // ---------- alertas ----------
  function calcularAlertas() {
    var out = { vencimientos: [], ajustes: [], mora: [], fallas: [] };
    var maxV = Math.max.apply(null, CONFIG.ALERTA_VENCIMIENTO);
    D.locales.forEach(function (l) {
      var r = resumenLocal(l);
      if (r.contrato) {
        if (r.diasVenc !== null && r.diasVenc <= maxV) out.vencimientos.push({ l: l, r: r, dias: r.diasVenc });
        if (r.diasAjuste !== null && r.diasAjuste <= CONFIG.ALERTA_AJUSTE) out.ajustes.push({ l: l, r: r, dias: r.diasAjuste });
      }
      if (r.totalDeuda > 0) out.mora.push({ l: l, r: r });
    });
    D.mantenimiento.forEach(function (m) { if (m.estado !== 'RESUELTO' && m.prioridad === 'ALTA') out.fallas.push(m); });
    out.vencimientos.sort(function (a, b) { return a.dias - b.dias; });
    out.ajustes.sort(function (a, b) { return a.dias - b.dias; });
    out.mora.sort(function (a, b) { return b.r.totalDeuda - a.r.totalDeuda; });
    out.total = out.vencimientos.length + out.ajustes.length + out.mora.length + out.fallas.length;
    return out;
  }

  // ---------- render general ----------
  function renderTodo() {
    renderKpis();
    renderFiltros();
    renderLista();
    renderPlantas();
    renderSectores();
    pintarMapa();
    var n = calcularAlertas().total;
    $('alertas-num').textContent = n; $('alertas-num').hidden = !n;
    if (localSel) renderFicha();
  }

  function renderKpis() {
    var act = D.locales.filter(function (l) { return l.activo !== false; });
    var m2Tot = 0, m2Alq = 0, alq = 0, jud = 0, deuda = 0, deudaLoc = 0, mant = 0, libres = 0;
    act.forEach(function (l) {
      var r = resumenLocal(l); m2Tot += REGLAS.num(l.m2);
      if (l.estado === 'ALQUILADO') { alq++; m2Alq += REGLAS.num(l.m2); }
      if (l.estado === 'JUDICIAL') { jud++; m2Alq += REGLAS.num(l.m2); }
      if (l.estado === 'LIBRE') libres++;
      if (r.totalDeuda > 0) { deuda += r.totalDeuda; deudaLoc++; }
    });
    mant = D.mantenimiento.filter(function (m) { return m.estado !== 'RESUELTO'; }).length;
    var pct = act.length ? Math.round((alq + jud) / act.length * 100) : 0;
    $('kpis').innerHTML =
      kpi('Ocupación', pct + '%', (alq + jud) + ' de ' + act.length + ' unidades' + (jud ? ' · ' + jud + ' en gestión judicial' : ''), 'kpi-ok') +
      (m2Tot ? kpi('m² alquilados', m2Alq.toLocaleString('es-AR'), 'de ' + m2Tot.toLocaleString('es-AR') + ' m² · libres: ' + (m2Tot - m2Alq).toLocaleString('es-AR'), '')
        : kpi('m² alquilados', '—', 'falta cargar superficies', '')) +
      kpi('Unidades libres', libres, libres === 1 ? 'disponible' : 'disponibles', '') +
      kpi('Deuda total', fmtMonto(deuda), deudaLoc + (deudaLoc === 1 ? ' unidad con deuda' : ' unidades con deuda'), 'kpi-deuda') +
      kpi('Mant. pendiente', mant, mant === 1 ? 'trabajo abierto' : 'trabajos abiertos', 'kpi-mant');
  }
  function kpi(label, valor, sub, cls) { return '<div class="kpi ' + cls + '"><div class="kpi-label">' + label + '</div><div class="kpi-valor">' + valor + '</div><div class="kpi-sub">' + sub + '</div></div>'; }

  function renderFiltros() {
    var cnt = { todos: 0, libre: 0, aldia: 0, deuda: 0, refaccion: 0, judicial: 0, inactivo: 0, mant: 0 };
    D.locales.forEach(function (l) {
      if (sectorActual !== 'TODO' && l.sector !== sectorActual) return;
      if (filtroCategoria && l.categoria !== filtroCategoria) return;
      var r = resumenLocal(l); cnt.todos++; cnt[r.estadoVisual] = (cnt[r.estadoVisual] || 0) + 1; if (r.mantPend.length) cnt.mant++;
    });
    var defs = [['todos', 'Todos'], ['libre', 'Libres'], ['aldia', 'Al día'], ['deuda', 'Con deuda'], ['refaccion', 'Refacción'], ['mant', 'Con mant.']];
    if (cnt.judicial) defs.push(['judicial', 'Judicial']);
    if (cnt.inactivo) defs.push(['inactivo', 'Uso interno']);
    // Selector de categoría (boletería / local / góndola / oficina...)
    var cats = (D.listas.categorias || []).filter(function (c) { return D.locales.some(function (l) { return l.categoria === c; }); });
    var sel = $('filtro-categoria');
    if (sel && cats.length) { sel.hidden = false; sel.innerHTML = '<option value="">Todas las categorías</option>' + opciones(cats, filtroCategoria); sel.onchange = function () { filtroCategoria = sel.value; renderFiltros(); renderLista(); pintarMapa(); }; }
    else if (sel) sel.hidden = true;
    $('filtros').innerHTML = defs.map(function (d) { return '<button class="chip' + (filtroEstado === d[0] ? ' activo' : '') + '" data-f="' + d[0] + '">' + d[1] + '<span class="n">' + cnt[d[0]] + '</span></button>'; }).join('');
    $('filtros').querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { filtroEstado = b.dataset.f; renderFiltros(); renderLista(); pintarMapa(); }; });
  }

  function renderLista() {
    var items = localesFiltrados();
    if (!items.length) { $('lista-locales').innerHTML = '<div class="lista-vacia">Ningún local coincide con el filtro.</div>'; return; }
    $('lista-locales').innerHTML = items.map(function (x) {
      var det = x.r.estadoVisual === 'inactivo' ? (x.r.contrato ? x.r.contrato.inquilino : (x.l.rubro || 'Uso interno'))
        : x.r.contrato ? x.r.contrato.inquilino : (x.l.estado === 'REFACCION' ? 'En refacción' : 'Libre' + (REGLAS.num(x.l.m2) ? ' · ' + x.l.m2 + ' m²' : ''));
      if (!zonasDe(x.l).length && !(sinZonaEnPlano(x.l) === false)) det += ' · sin ubicación en el plano';
      var tag = x.r.totalDeuda > 0 ? fmtMonto(x.r.totalDeuda) : (x.r.mantPend.length ? '🔧 ' + x.r.mantPend.length : (x.r.contratoIncompleto ? '<span title="Faltan datos del contrato">contrato incompleto</span>' : ''));
      var donde = sectorActual === 'TODO' ? (x.l.sector || nombrePlanta(x.l.planta)) : '';
      return '<li data-id="' + x.l.id_local + '" class="' + (localSel === x.l.id_local ? 'sel' : '') + '">' +
        '<span class="punto sw-' + x.r.estadoVisual + '"></span>' +
        '<div><div class="nom">' + esc(x.l.nombre) + (donde ? ' <span style="color:var(--texto-3);font-weight:400">· ' + esc(donde) + '</span>' : '') + '</div><div class="det">' + esc(det) + '</div></div>' +
        '<div class="tag">' + tag + (x.r.mantPend.length && x.r.totalDeuda > 0 ? '<br>🔧 ' + x.r.mantPend.length : '') + '</div></li>';
    }).join('');
    $('lista-locales').querySelectorAll('li').forEach(function (li) { li.onclick = function () { abrirFicha(li.dataset.id, null, false); }; });
  }

  // true si la unidad no está dibujada en el plano de su planta (false si sí está; null si su planta no tiene plano)
  function sinZonaEnPlano(l) {
    if (!tienePlano(l.planta)) return null;
    var svg = $('mapa').querySelector('svg'); if (!svg) return null;
    var zs = zonasDe(l); if (!zs.length) zs = [l.id_local];
    return !zs.some(function (z) { return !!svg.getElementById(z); });
  }

  // ---------- sectores (vistas con zoom dentro de una planta) ----------
  function sectoresDePlanta() {
    var presentes = {};
    D.locales.forEach(function (l) { if (l.sector) presentes[l.sector] = (presentes[l.sector] || 0) + 1; });
    var orden = CONFIG.SECTORES || [];
    return Object.keys(presentes).sort(function (a, b) { var ia = orden.indexOf(a), ib = orden.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); })
      .map(function (s) { return { id: s, n: presentes[s] }; });
  }
  function renderSectores() {
    var secs = sectoresDePlanta();
    var cont = $('sectores-tabs');
    if (!secs.length) { cont.innerHTML = ''; return; }
    cont.innerHTML = '<button data-s="TODO" class="' + (sectorActual === 'TODO' ? 'activa' : '') + '">Todo</button>' +
      secs.map(function (s) { return '<button data-s="' + esc(s.id) + '" class="' + (sectorActual === s.id ? 'activa' : '') + '">' + esc(s.id) + ' <span style="opacity:.6">' + s.n + '</span></button>'; }).join('');
    cont.querySelectorAll('button').forEach(function (b) { b.onclick = function () { cambiarSector(b.dataset.s); }; });
  }
  function cajaSector(sector) {
    var svg = $('mapa').querySelector('svg'); if (!svg || !vistaBase) return vistaBase;
    if (sector === 'TODO') return vistaBase.slice();
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    D.locales.forEach(function (l) {
      if (l.sector !== sector) return;
      var zs = zonasDe(l); if (!zs.length) zs = [l.id_local];
      zs.forEach(function (idz) {
        var z = svg.getElementById(idz); if (!z) return;
        var bb = z.getBBox(); n++;
        x0 = Math.min(x0, bb.x); y0 = Math.min(y0, bb.y); x1 = Math.max(x1, bb.x + bb.width); y1 = Math.max(y1, bb.y + bb.height);
      });
    });
    if (!n) return vistaBase.slice();
    var mx = (x1 - x0) * 0.08 + 4, my = (y1 - y0) * 0.12 + 4;
    return ajustarAspecto([x0 - mx, y0 - my, (x1 - x0) + 2 * mx, (y1 - y0) + 2 * my]);
  }
  // Ensancha el viewBox para que respete la proporción del contenedor (así el zoom no deja bandas raras)
  function ajustarAspecto(vb) {
    var svg = $('mapa').querySelector('svg'); if (!svg) return vb;
    var r = svg.getBoundingClientRect(); if (!r.width || !r.height) return vb;
    var asp = r.width / r.height, w = vb[2], h = vb[3];
    if (w / h < asp) { var nw = h * asp; return [vb[0] - (nw - w) / 2, vb[1], nw, h]; }
    var nh = w / asp; return [vb[0], vb[1] - (nh - h) / 2, w, nh];
  }
  function setViewBox(vb) {
    var svg = $('mapa').querySelector('svg'); if (!svg) return;
    svg.setAttribute('viewBox', vb.map(function (v) { return Math.round(v * 100) / 100; }).join(' '));
    svg._vb = vb;
  }
  function cambiarSector(s) {
    sectorActual = s;
    renderSectores(); renderFiltros(); renderLista();
    vistaSector = cajaSector(s); setViewBox(vistaSector);
    pintarMapa();
  }
  function zoomEn(factor, px, py) {
    var svg = $('mapa').querySelector('svg'); if (!svg || !svg._vb) return;
    var vb = svg._vb, r = svg.getBoundingClientRect();
    var fx = px === undefined ? 0.5 : (px - r.left) / r.width, fy = py === undefined ? 0.5 : (py - r.top) / r.height;
    var nw = vb[2] / factor, nh = vb[3] / factor;
    var maxW = vistaBase[2] * 1.3; if (nw > maxW) { factor = vb[2] / maxW; nw = maxW; nh = vb[3] / factor; }
    var minW = 40; if (nw < minW) { nw = minW; nh = vb[3] * (minW / vb[2]); }
    setViewBox([vb[0] + (vb[2] - nw) * fx, vb[1] + (vb[3] - nh) * fy, nw, nh]);
  }
  function activarPanZoom(svg) {
    var punteros = {}, arrastre = null, pinch = null, movio = false;
    svg.addEventListener('wheel', function (e) { e.preventDefault(); zoomEn(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY); }, { passive: false });
    svg.addEventListener('pointerdown', function (e) {
      // OJO: no capturar el puntero acá. Con captura, el click llega al <svg> y no al local: la ficha no se abre.
      // La captura se toma recién cuando hay arrastre real (ver pointermove).
      punteros[e.pointerId] = { x: e.clientX, y: e.clientY }; movio = false;
      var ids = Object.keys(punteros);
      if (ids.length === 1) arrastre = { x: e.clientX, y: e.clientY, vb: svg._vb.slice() };
      else if (ids.length === 2) { var a = punteros[ids[0]], b = punteros[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), vb: svg._vb.slice(), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; arrastre = null; }
    });
    svg.addEventListener('pointermove', function (e) {
      if (!punteros[e.pointerId]) return;
      punteros[e.pointerId] = { x: e.clientX, y: e.clientY };
      var r = svg.getBoundingClientRect();
      if (pinch) {
        var ids = Object.keys(punteros); if (ids.length < 2) return;
        var a = punteros[ids[0]], b = punteros[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (!movio) { Object.keys(punteros).forEach(function (id) { try { svg.setPointerCapture(Number(id)); } catch (err) { } }); }
        var f = Math.max(0.2, Math.min(5, d / pinch.d)); var vb = pinch.vb;
        var fx = (pinch.cx - r.left) / r.width, fy = (pinch.cy - r.top) / r.height, nw = vb[2] / f, nh = vb[3] / f;
        setViewBox([vb[0] + (vb[2] - nw) * fx, vb[1] + (vb[3] - nh) * fy, nw, nh]); movio = true; return;
      }
      if (arrastre) {
        var dx = (e.clientX - arrastre.x) * (arrastre.vb[2] / r.width), dy = (e.clientY - arrastre.y) * (arrastre.vb[3] / r.height);
        if (Math.abs(e.clientX - arrastre.x) + Math.abs(e.clientY - arrastre.y) > 4) {
          if (!movio) { try { svg.setPointerCapture(e.pointerId); } catch (err) { } }
          movio = true; svg.classList.add('arrastrando');
        }
        setViewBox([arrastre.vb[0] - dx, arrastre.vb[1] - dy, arrastre.vb[2], arrastre.vb[3]]);
      }
    });
    var soltar = function (e) {
      delete punteros[e.pointerId];
      if (!Object.keys(punteros).length) { arrastre = null; pinch = null; svg.classList.remove('arrastrando'); }
      else if (Object.keys(punteros).length === 1) { pinch = null; var k = Object.keys(punteros)[0]; arrastre = { x: punteros[k].x, y: punteros[k].y, vb: svg._vb.slice() }; }
    };
    svg.addEventListener('pointerup', soltar); svg.addEventListener('pointercancel', soltar);
    // Un click sobre una zona después de arrastrar no debe abrir la ficha
    svg.addEventListener('click', function (e) { if (movio) { e.stopPropagation(); e.preventDefault(); movio = false; } }, true);
  }

  function renderPlantas() {
    $('plantas-tabs').hidden = CONFIG.PLANTAS.length < 2;
    $('plantas-tabs').innerHTML = CONFIG.PLANTAS.map(function (p) {
      var n = D.locales.filter(function (l) { return l.planta === p.id; }).length;
      return '<button data-p="' + p.id + '" class="' + (plantaActual === p.id ? 'activa' : '') + '">' + esc(p.nombre) + ' <span style="opacity:.6">' + n + '</span></button>';
    }).join('');
    $('plantas-tabs').querySelectorAll('button').forEach(function (b) { b.onclick = function () { cambiarPlanta(b.dataset.p); }; });
  }

  // ---------- mapa ----------
  async function cambiarPlanta(id) {
    plantaActual = id; sectorActual = 'TODO';
    renderPlantas();
    await cargarPlano();
    renderSectores(); renderFiltros(); renderLista();
    pintarMapa();
  }
  async function cargarPlano() {
    var p = CONFIG.PLANTAS.filter(function (x) { return x.id === plantaActual; })[0];
    if (!svgCache[p.id]) {
      try { var r = await fetch(p.archivo + '?v=' + Date.now()); svgCache[p.id] = await r.text(); }
      catch (e) { $('mapa').innerHTML = '<div class="cargando">No se pudo cargar el plano ' + esc(p.archivo) + '.</div>'; return; }
    }
    $('mapa').innerHTML = svgCache[p.id];
    var svg = $('mapa').querySelector('svg');
    if (!svg) return;
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    reindexarZonas();
    // Patrón para "en gestión judicial" (violeta rayado), por si el SVG no lo trae
    if (!svg.querySelector('#rayado-judicial')) {
      var defs = svg.querySelector('defs') || svg.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'defs'), svg.firstChild);
      defs.insertAdjacentHTML('beforeend', '<pattern id="rayado-judicial" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="#ede9fe"/><line x1="0" y1="0" x2="0" y2="6" stroke="#7e22ce" stroke-width="2.5"/></pattern>');
    }
    vistaBase = (svg.getAttribute('viewBox') || '0 0 1000 600').split(/[\s,]+/).map(Number);
    vistaBase = ajustarAspecto(vistaBase);
    vistaSector = cajaSector(sectorActual);
    setViewBox(vistaSector);
    activarPanZoom(svg);
    // Avisar si el plano tiene zonas sin local o locales sin zona (diagnóstico del plano)
    var zonas = Array.prototype.slice.call(svg.querySelectorAll('.zona'));
    var idsPlano = zonas.map(function (z) { return z.id; });
    var sinDatos = idsPlano.filter(function (i) { return !zonaALocal[i]; });
    var sinZona = D.locales.filter(function (l) { return l.planta === p.id && !(zonasDe(l).length ? zonasDe(l) : [l.id_local]).some(function (z) { return idsPlano.indexOf(z) >= 0; }); }).map(function (l) { return l.id_local; });
    if (sinDatos.length || sinZona.length) console.warn('Plano ' + p.id + ' — zonas sin unidad asignada: ' + sinDatos.join(', ') + ' | unidades de esta planta sin zona en el plano: ' + sinZona.join(', '));
    zonas.forEach(function (z) {
      var l = localDeZona(z.id);
      var t0 = z.querySelector('title'); var etiquetaPlano = t0 ? t0.textContent : z.id.replace(/^L-/, '');
      z.setAttribute('data-etiqueta', etiquetaPlano);
      z.onclick = function () {
        var lz = localDeZona(z.id);
        if (lz) abrirFicha(lz.id_local, null, true);
        else toast('La zona ' + z.id + ' del plano no tiene unidad asignada. Se asigna en la planilla de relevamiento (columna zonas_plano).', true);
      };
      var bb = z.getBBox();
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'etiqueta'); g.setAttribute('data-for', z.id);
      var texto = etiquetaPlano;   // el número que figura en el plano, que es como lo nombra todo el mundo
      // Tamaño de letra proporcional a la zona: entra en el ancho y no supera la mitad del alto
      var fs = Math.max(2, Math.min(16, bb.width / (Math.max(texto.length, 2) * 0.62), bb.height * 0.5));
      var conSub = bb.width > 26 && bb.height > 16;
      var cy0 = bb.y + bb.height / 2 + (conSub ? -fs * 0.15 : fs * 0.35);
      g.innerHTML = '<text x="' + (bb.x + bb.width / 2) + '" y="' + cy0 + '" text-anchor="middle" font-size="' + fs + '">' + esc(texto) + '</text>' +
        (conSub ? '<text class="sub" x="' + (bb.x + bb.width / 2) + '" y="' + (cy0 + fs * 0.9) + '" text-anchor="middle" font-size="' + (fs * .62) + '" data-sub="' + z.id + '"></text>' : '');
      z.parentNode.insertBefore(g, z.nextSibling);
      var badge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      badge.setAttribute('class', 'badge-mant'); badge.setAttribute('data-for', z.id); badge.setAttribute('visibility', 'hidden');
      var br = Math.max(2.5, Math.min(8, Math.min(bb.width, bb.height) * 0.28));
      badge.innerHTML = '<circle cx="' + (bb.x + bb.width - br - 1) + '" cy="' + (bb.y + br + 1) + '" r="' + br + '"/><text x="' + (bb.x + bb.width - br - 1) + '" y="' + (bb.y + br + 1 + br * 0.4) + '" text-anchor="middle" font-size="' + (br * 1.15) + '">🔧</text>';
      g.parentNode.insertBefore(badge, g.nextSibling);
      if (!t0) { var t = document.createElementNS('http://www.w3.org/2000/svg', 'title'); z.appendChild(t); }
    });
  }
  function pintarMapa() {
    var svg = $('mapa').querySelector('svg'); if (!svg) return;
    var visibles = {}; localesFiltrados().forEach(function (x) { visibles[x.l.id_local] = true; });
    svg.querySelectorAll('.zona').forEach(function (z) {
      var l = localDeZona(z.id);
      var et = svg.querySelector('.etiqueta[data-for="' + z.id + '"]'), bd = svg.querySelector('.badge-mant[data-for="' + z.id + '"]');
      if (!l) {
        z.setAttribute('data-estado', 'sindatos'); z.classList.remove('sel');
        var t0 = z.querySelector('title'); if (t0) t0.textContent = z.id + ' · sin unidad asignada';
        return;
      }
      var r = resumenLocal(l);
      z.setAttribute('data-estado', r.estadoVisual);
      z.classList.toggle('sel', localSel === l.id_local);
      var aten = !visibles[l.id_local];
      z.classList.toggle('atenuada', aten); if (et) et.classList.toggle('atenuada', aten); if (bd) bd.classList.toggle('atenuada', aten);
      if (bd) bd.setAttribute('visibility', r.mantPend.length ? 'visible' : 'hidden');
      var sub = svg.querySelector('[data-sub="' + z.id + '"]');
      if (sub) sub.textContent = r.contrato ? r.contrato.inquilino : (l.estado === 'REFACCION' ? 'refacción' : r.estadoVisual === 'inactivo' ? (l.rubro || 'uso interno') : 'libre' + (REGLAS.num(l.m2) ? ' · ' + l.m2 + ' m²' : ''));
      var t = z.querySelector('title'); if (t) t.textContent = l.nombre + (r.contrato ? ' · ' + r.contrato.inquilino : '') + ' · ' + NOMBRE_ESTADO[r.estadoVisual] + (r.totalDeuda ? ' · debe ' + fmtMonto(r.totalDeuda) : '') + (r.mantPend.length ? ' · ' + r.mantPend.length + ' trabajo(s) pendiente(s)' : '');
    });
  }

  // ---------- ficha ----------
  // desdeMapa=true: el usuario ya está viendo el local, no se mueve la vista. Desde la lista o alertas: se enfoca su sector.
  async function abrirFicha(id, tab, desdeMapa) {
    localSel = id; if (tab) tabFicha = tab;
    var l = D.locales.filter(function (x) { return x.id_local === id; })[0];
    if (l && l.planta !== plantaActual && tienePlano(l.planta)) { await cambiarPlanta(l.planta); }
    if (l && !desdeMapa && l.sector && sectorActual !== l.sector && tienePlano(l.planta)) cambiarSector(l.sector);
    $('ficha').hidden = false; $('ficha-fondo').hidden = false; $('panel-alertas').hidden = true;
    renderFicha(); renderLista(); pintarMapa();
  }
  function cerrarFicha() { localSel = null; $('ficha').hidden = true; $('ficha-fondo').hidden = true; renderLista(); pintarMapa(); }

  function renderFicha() {
    var l = D.locales.filter(function (x) { return x.id_local === localSel; })[0]; if (!l) return;
    var r = resumenLocal(l);
    var ubic = tienePlano(l.planta) ? nombrePlanta(l.planta) : (l.planta === 'PA' ? 'Planta alta (sin plano)' : l.planta === 'EXT' ? 'Predio / exterior' : l.planta);
    $('ficha-id').textContent = l.id_local + (l.categoria ? ' · ' + l.categoria : '') + ' · ' + ubic + (l.sector ? ' · ' + l.sector : '') + (zonasDe(l).length ? ' · plano: ' + zonasDe(l).join(', ') : (tienePlano(l.planta) ? ' · sin ubicación en el plano' : ''));
    $('ficha-titulo').textContent = l.nombre + (r.contrato ? ' — ' + r.contrato.inquilino : '');
    $('ficha-sub').textContent = (REGLAS.num(l.m2) ? l.m2 + ' m²' : 'superficie sin cargar') + (l.rubro ? ' · ' + l.rubro : '');
    $('ficha-estado').innerHTML = '<span class="pill pill-' + r.estadoVisual + '">' + NOMBRE_ESTADO[r.estadoVisual] + '</span>' +
      (r.contratoIncompleto ? '<span class="pill pill-gris" title="Faltan fechas o monto del contrato">Contrato incompleto</span>' : '') +
      (r.totalDeuda ? '<span class="pill pill-deuda">Debe ' + fmtMonto(r.totalDeuda) + '</span>' : '') +
      (r.mantPend.length ? '<span class="pill pill-mant">🔧 ' + r.mantPend.length + ' pendiente' + (r.mantPend.length > 1 ? 's' : '') + '</span>' : '');
    $('ficha-tabs').querySelectorAll('button').forEach(function (b) { b.classList.toggle('activa', b.dataset.tab === tabFicha); });
    var f = { resumen: tabResumen, contrato: tabContrato, pagos: tabPagos, mantenimiento: tabMantenimiento, historial: tabHistorial }[tabFicha];
    $('ficha-cuerpo').innerHTML = f(l, r);
    enlazarAcciones(l, r);
  }
  function dato(k, v, ancho) { return '<div class="dato' + (ancho ? ' ancho' : '') + '"><div class="k">' + k + '</div><div class="v">' + (v === '' || v === undefined || v === null ? '—' : v) + '</div></div>'; }

  function tabResumen(l, r) {
    var h = '';
    h += '<div class="bloque"><h3>Estado del local <button class="btn btn-chico" data-accion="editar-local">Editar</button></h3><div class="datos">' +
      dato('Estado', '<span class="pill pill-' + r.estadoVisual + '">' + NOMBRE_ESTADO[r.estadoVisual] + '</span>') + dato('Superficie', l.m2 + ' m²') +
      dato('Rubro', esc(l.rubro)) + dato('Sector', esc(l.sector)) + dato('Observaciones', esc(l.observaciones), true) + '</div></div>';
    if (r.contrato) {
      var c = r.contrato;
      if (r.contratoIncompleto) h += '<div class="aviso">A este contrato le faltan datos (fechas de inicio y fin, o monto): se cargó desde las planillas de alquileres y cobranzas, que no los tienen. Completalo desde la pestaña Contrato → Editar, o en la planilla de relevamiento.</div>';
      h += '<div class="bloque"><h3>Contrato vigente <button class="btn btn-chico" data-tab-ir="contrato">Ver</button></h3><div class="datos">' +
        dato('Inquilino', esc(c.inquilino)) + dato('Alquiler mensual', fmtMonto(c.monto_alquiler)) +
        dato('Vence', fmtFecha(c.fecha_fin) + avisoDias(r.diasVenc, 'vence')) + dato('Próximo ajuste', c.proxima_fecha_ajuste ? fmtFecha(c.proxima_fecha_ajuste) + ' (' + esc(c.indice_ajuste) + ')' + avisoDias(r.diasAjuste, 'ajusta') : '—') + '</div></div>';
      h += '<div class="bloque"><h3>Situación de pagos <button class="btn btn-chico" data-tab-ir="pagos">Ver</button></h3>';
      if (r.totalDeuda > 0) {
        h += '<div class="aviso">Debe <strong>' + fmtMonto(r.totalDeuda) + '</strong>: ' + descDeuda(r.deuda) + '.</div>';
      } else h += '<div class="aviso aviso-ok">Al día. No tiene cuotas vencidas impagas.</div>';
      h += '</div>';
    } else {
      h += '<div class="bloque"><h3>Contrato</h3><div class="vacio">Sin contrato vigente.</div><div class="acciones"><button class="btn btn-primario btn-chico" data-accion="nuevo-contrato">+ Cargar contrato</button></div></div>';
    }
    h += '<div class="bloque"><h3>Mantenimiento <button class="btn btn-chico" data-tab-ir="mantenimiento">Ver</button></h3>';
    h += r.mantPend.length ? r.mantPend.map(itemMant).join('') : '<div class="vacio">Sin trabajos pendientes.</div>';
    h += '</div>';
    return h;
  }
  function avisoDias(d, verbo) { if (d === null || d === undefined) return ''; if (d < 0) return ' <span class="pill pill-deuda">vencido hace ' + (-d) + ' d</span>'; if (d <= 90) return ' <span class="pill ' + (d <= 30 ? 'pill-deuda' : 'pill-gris') + '">' + verbo + ' en ' + d + ' d</span>'; return ''; }
  function descDeuda(d) {
    var p = [];
    if (d.ALQUILER.meses) p.push(d.ALQUILER.meses + (d.ALQUILER.meses === 1 ? ' mes' : ' meses') + ' de alquiler (' + fmtMonto(d.ALQUILER.monto) + ')');
    if (d.EXPENSAS.meses) p.push(d.EXPENSAS.meses + (d.EXPENSAS.meses === 1 ? ' mes' : ' meses') + ' de expensas (' + fmtMonto(d.EXPENSAS.monto) + ')');
    return p.join(' y ');
  }

  function tabContrato(l, r) {
    var h = '';
    var c = r.contrato;
    if (c) {
      h += '<div class="bloque"><h3>Contrato vigente · ' + c.id_contrato + ' <span><button class="btn btn-chico" data-accion="editar-contrato" data-id="' + c.id_contrato + '">Editar</button> <button class="btn btn-chico" data-accion="cerrar-contrato" data-id="' + c.id_contrato + '">Finalizar / rescindir</button></span></h3><div class="datos">' +
        dato('Inquilino', esc(c.inquilino)) + dato('CUIT', esc(c.cuit)) + dato('Contacto', esc(c.contacto), true) +
        dato('Inicio', fmtFecha(c.fecha_inicio)) + dato('Fin', fmtFecha(c.fecha_fin) + avisoDias(r.diasVenc, 'vence')) +
        dato('Alquiler mensual', '<span class="destacado">' + fmtMonto(c.monto_alquiler) + '</span>') + dato('Expensas mensuales', fmtMonto(c.expensas_mensuales)) +
        dato('Índice de ajuste', esc(c.indice_ajuste) + (c.periodicidad_meses ? ' · cada ' + c.periodicidad_meses + ' meses' : '')) + dato('Próximo ajuste', c.proxima_fecha_ajuste ? fmtFecha(c.proxima_fecha_ajuste) + avisoDias(r.diasAjuste, 'ajusta') : '—') +
        dato('Depósito / garantía', fmtMonto(c.deposito)) + dato('Observaciones', esc(c.observaciones)) + '</div>' +
        '<p class="campo ayuda" style="margin:8px 0 0;font-size:.78rem;color:var(--texto-3)">Cuando toque el ajuste, editá el contrato: cargá el monto nuevo y la próxima fecha. Las cuotas futuras salen con el monto vigente al generarlas.</p></div>';
    } else {
      h += '<div class="bloque"><h3>Contrato vigente</h3><div class="vacio">Este local no tiene contrato vigente.</div>' +
        (l.estado === 'REFACCION' ? '<div class="aviso">El local está en refacción. Al cargar un contrato pasa a ALQUILADO.</div>' : '') +
        '<div class="acciones"><button class="btn btn-primario" data-accion="nuevo-contrato">+ Cargar contrato</button></div></div>';
    }
    var hist = D.contratos.filter(function (x) { return x.id_local === l.id_local && x.estado_contrato !== 'VIGENTE'; }).sort(function (a, b) { return b.fecha_inicio < a.fecha_inicio ? -1 : 1; });
    h += '<div class="bloque"><h3>Contratos anteriores</h3>';
    h += hist.length ? '<div class="tabla-wrap"><table class="tabla"><tr><th>Inquilino</th><th>Período</th><th class="num">Alquiler</th><th>Estado</th></tr>' +
      hist.map(function (c) { return '<tr><td>' + esc(c.inquilino) + '</td><td>' + fmtFecha(c.fecha_inicio) + ' → ' + fmtFecha(c.fecha_fin) + '</td><td class="num">' + fmtMonto(c.monto_alquiler) + '</td><td>' + c.estado_contrato + '</td></tr>'; }).join('') + '</table></div>'
      : '<div class="vacio">No hay contratos anteriores.</div>';
    h += '</div>';
    return h;
  }

  function tabPagos(l, r) {
    var cuotas = D.cuotas.filter(function (q) { return q.id_local === l.id_local; }).sort(function (a, b) { return a.periodo === b.periodo ? (a.concepto < b.concepto ? -1 : 1) : (a.periodo < b.periodo ? 1 : -1); });
    var h = '';
    if (r.totalDeuda > 0) h += '<div class="aviso">Debe <strong>' + fmtMonto(r.totalDeuda) + '</strong>: ' + descDeuda(r.deuda) + '.</div>';
    else if (r.contrato) h += '<div class="aviso aviso-ok">Al día.</div>';
    var abiertas = cuotas.filter(function (q) { return q.estado !== 'PAGADA'; });
    h += '<div class="acciones" style="margin:0 0 10px">' + (abiertas.length ? '<button class="btn btn-primario" data-accion="registrar-pago">+ Registrar pago</button>' : '') + '</div>';
    h += '<div class="bloque"><h3>Cuotas</h3>';
    if (!cuotas.length) h += '<div class="vacio">Todavía no hay cuotas generadas para este local. Usá “+ Cuotas del mes” arriba.</div>';
    else {
      h += '<div class="tabla-wrap"><table class="tabla"><tr><th>Período</th><th>Concepto</th><th class="num">Monto</th><th class="num">Saldo</th><th>Estado</th></tr>' + cuotas.map(function (q) {
        var saldo = REGLAS.saldoCuota(D, q); var vencida = q.estado !== 'PAGADA' && q.vencimiento < HOY;
        var pill = q.estado === 'PAGADA' ? 'pill-aldia' : vencida ? 'pill-deuda' : 'pill-gris';
        var txt = q.estado === 'PAGADA' ? 'Pagada' : vencida ? (q.estado === 'PARCIAL' ? 'Parcial · vencida' : 'Vencida') : (q.estado === 'PARCIAL' ? 'Parcial' : 'Vence ' + fmtFecha(q.vencimiento));
        return '<tr' + (q.estado !== 'PAGADA' ? ' class="fila-click" data-accion="registrar-pago" data-cuota="' + q.id_cuota + '" title="Registrar pago de esta cuota"' : '') + '><td>' + fmtPeriodo(q.periodo) + '</td><td>' + q.concepto.charAt(0) + q.concepto.slice(1).toLowerCase() + '</td><td class="num">' + fmtMonto(q.monto) + '</td><td class="num">' + (saldo ? fmtMonto(saldo) : '—') + '</td><td><span class="pill ' + pill + '">' + txt + '</span></td></tr>';
      }).join('') + '</table></div>';
    }
    h += '</div>';
    var pagos = D.pagos.filter(function (p) { return p.id_local === l.id_local; }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    h += '<div class="bloque"><h3>Historial de pagos</h3>';
    h += pagos.length ? '<div class="tabla-wrap"><table class="tabla"><tr><th>Fecha</th><th>Cuota</th><th class="num">Monto</th><th>Medio</th><th>Comprobante</th></tr>' + pagos.map(function (p) {
      var q = D.cuotas.filter(function (x) { return x.id_cuota === p.id_cuota; })[0];
      return '<tr><td>' + fmtFecha(p.fecha) + '</td><td>' + (q ? q.concepto.toLowerCase() + ' ' + fmtPeriodo(q.periodo) : p.id_cuota) + '</td><td class="num">' + fmtMonto(p.monto) + '</td><td>' + esc(p.medio) + '</td><td>' + esc(p.comprobante) + '</td></tr>';
    }).join('') + '</table></div>' : '<div class="vacio">Sin pagos registrados.</div>';
    h += '</div>';
    return h;
  }

  function itemMant(m) {
    return '<div class="item-mant"><div class="fila1"><span class="desc">' + esc(m.descripcion) + '</span><span><span class="pill pill-' + m.prioridad + '">' + m.prioridad + '</span> <span class="pill pill-gris">' + m.estado + '</span></span></div>' +
      '<div class="meta">' + esc(m.tipo_falla) + ' · reportada ' + fmtFecha(m.fecha_reporte) + (m.quien_intervino ? ' · ' + esc(m.quien_intervino) : '') + (m.fecha_resolucion ? ' · resuelta ' + fmtFecha(m.fecha_resolucion) : '') + (m.costo !== '' && m.costo !== undefined ? ' · ' + fmtMonto(m.costo) : '') + (m.id_local === 'COMUN' ? ' · Área común ' + nombrePlanta(m.planta) : '') + '</div>' +
      (m.observaciones ? '<div class="meta">' + esc(m.observaciones) + '</div>' : '') +
      '<div class="acciones" style="margin-top:4px"><button class="btn btn-chico" data-accion="editar-mant" data-id="' + m.id_mant + '">' + (m.estado === 'RESUELTO' ? 'Ver / editar' : 'Actualizar') + '</button></div></div>';
  }
  function tabMantenimiento(l, r) {
    var todas = D.mantenimiento.filter(function (m) { return m.id_local === l.id_local; });
    var pend = todas.filter(function (m) { return m.estado !== 'RESUELTO'; }).sort(function (a, b) { return REGLAS.PRIORIDADES.indexOf(a.prioridad) - REGLAS.PRIORIDADES.indexOf(b.prioridad); });
    var res = todas.filter(function (m) { return m.estado === 'RESUELTO'; }).sort(function (a, b) { return a.fecha_resolucion < b.fecha_resolucion ? 1 : -1; });
    var costo = res.reduce(function (s, m) { return s + REGLAS.num(m.costo); }, 0);
    var h = '<div class="acciones" style="margin:0 0 10px"><button class="btn btn-primario" data-accion="nueva-falla">+ Reportar falla</button></div>';
    h += '<div class="bloque"><h3>Pendientes (' + pend.length + ')</h3>' + (pend.length ? pend.map(itemMant).join('') : '<div class="vacio">Sin trabajos pendientes.</div>') + '</div>';
    h += '<div class="bloque"><h3>Resueltas (' + res.length + ') <span style="font-weight:400;text-transform:none">costo total ' + fmtMonto(costo) + '</span></h3>' + (res.length ? res.map(itemMant).join('') : '<div class="vacio">Sin historial.</div>') + '</div>';
    return h;
  }

  function tabHistorial(l) {
    var ids = { LOCALES: [l.id_local], CONTRATOS: D.contratos.filter(function (c) { return c.id_local === l.id_local; }).map(function (c) { return c.id_contrato; }),
      CUOTAS: D.cuotas.filter(function (q) { return q.id_local === l.id_local; }).map(function (q) { return q.id_cuota; }),
      PAGOS: D.pagos.filter(function (p) { return p.id_local === l.id_local; }).map(function (p) { return p.id_pago; }),
      MANTENIMIENTO: D.mantenimiento.filter(function (m) { return m.id_local === l.id_local; }).map(function (m) { return m.id_mant; }) };
    var items = D.historial.filter(function (h) { return ids[h.entidad] && ids[h.entidad].indexOf(h.id) >= 0; }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    if (!items.length) return '<div class="vacio">Sin cambios registrados para este local.</div>';
    return '<ul class="hist" style="list-style:none;padding:0;margin:0">' + items.map(function (h) {
      var que = h.campo === '(alta)' ? 'Alta de ' + h.entidad.toLowerCase() + ' ' + h.id + ': ' + esc(h.valor_nuevo) : h.entidad + ' ' + h.id + ' · <strong>' + esc(h.campo) + '</strong>: ' + esc(h.valor_anterior || '—') + ' → ' + esc(h.valor_nuevo || '—');
      return '<li><div class="cuando">' + esc(h.fecha) + ' · ' + esc(h.usuario) + '</div>' + que + '</li>';
    }).join('') + '</ul>';
  }

  function enlazarAcciones(l, r) {
    var cuerpo = $('ficha-cuerpo');
    cuerpo.querySelectorAll('[data-tab-ir]').forEach(function (b) { b.onclick = function () { tabFicha = b.dataset.tabIr; renderFicha(); }; });
    cuerpo.querySelectorAll('[data-accion]').forEach(function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        var a = b.dataset.accion;
        if (a === 'editar-local') formLocal(l, r);
        if (a === 'nuevo-contrato') formContrato(l, null);
        if (a === 'editar-contrato') formContrato(l, D.contratos.filter(function (c) { return c.id_contrato === b.dataset.id; })[0]);
        if (a === 'cerrar-contrato') formCerrarContrato(l, D.contratos.filter(function (c) { return c.id_contrato === b.dataset.id; })[0]);
        if (a === 'registrar-pago') formPago(l, b.dataset.cuota || '');
        if (a === 'nueva-falla') formMant(l, null);
        if (a === 'editar-mant') formMant(l, D.mantenimiento.filter(function (m) { return m.id_mant === b.dataset.id; })[0]);
      };
    });
  }

  // ---------- modal genérico ----------
  function abrirModal(titulo, camposHtml, onSubmit, textoBoton) {
    $('modal-titulo').textContent = titulo;
    var form = $('modal-form');
    form.innerHTML = camposHtml + '<div class="form-error" hidden><p class="error" id="modal-error"></p></div><div class="form-pie"><button type="button" class="btn" id="modal-cancelar">Cancelar</button><button type="submit" class="btn btn-primario">' + (textoBoton || 'Guardar') + '</button></div>';
    $('modal').hidden = false;
    $('modal-cancelar').onclick = cerrarModal;
    form.onsubmit = async function (ev) {
      ev.preventDefault();
      var btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Guardando…';
      var fd = {}; Array.prototype.forEach.call(form.elements, function (el) { if (el.name) fd[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
      try {
        var resp = await onSubmit(fd);
        if (resp && resp.datos) D = resp.datos;
        cerrarModal(); renderTodo();
        toast(resp && resp.mensaje ? resp.mensaje : 'Guardado.');
      } catch (e) {
        $('modal-error').textContent = e.message; $('modal-error').parentNode.hidden = false;
        btn.disabled = false; btn.textContent = textoBoton || 'Guardar';
      }
    };
    var primero = form.querySelector('input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea'); if (primero) primero.focus();
  }
  function cerrarModal() { $('modal').hidden = true; $('modal-form').innerHTML = ''; }
  function campo(label, inner, ancho, ayuda) { return '<div class="campo' + (ancho ? ' ancho' : '') + '"><label>' + label + '</label>' + inner + (ayuda ? '<div class="ayuda">' + ayuda + '</div>' : '') + '</div>'; }
  function inp(name, val, attrs) { return '<input name="' + name + '" value="' + esc(val === undefined || val === null ? '' : val) + '" ' + (attrs || '') + '>'; }
  function sel(name, lista, val, vacio, attrs) { return '<select name="' + name + '" ' + (attrs || '') + '>' + opciones(lista, val, vacio) + '</select>'; }

  // ---------- formularios ----------
  function formLocal(l, r) {
    var vig = !!r.contrato;
    // POKAYOKE: solo se ofrecen los estados que son válidos en esta situación
    var NOM = { LIBRE: 'LIBRE', ALQUILADO: 'ALQUILADO', REFACCION: 'EN REFACCIÓN', JUDICIAL: 'EN GESTIÓN JUDICIAL' };
    var estados = REGLAS.ESTADOS_LOCAL.map(function (e) {
      var dis = (e === 'LIBRE' && vig) || (e === 'ALQUILADO' && !vig);
      return '<option value="' + e + '"' + (l.estado === e ? ' selected' : '') + (dis ? ' disabled' : '') + '>' + NOM[e] + (dis ? (e === 'LIBRE' ? ' (tiene contrato vigente)' : ' (cargá el contrato primero)') : '') + '</option>';
    }).join('');
    abrirModal('Editar ' + l.nombre,
      campo('Estado', '<select name="estado">' + estados + '</select>', true, vig ? 'Para dejarlo LIBRE primero finalizá el contrato desde la pestaña Contrato. JUDICIAL se puede marcar con el contrato vigente.' : 'ALQUILADO se activa solo al cargar un contrato.') +
      campo('Nombre', inp('nombre', l.nombre, 'required')) + campo('Categoría', sel('categoria', D.listas.categorias || [], l.categoria, '— sin categoría —')) +
      campo('Superficie (m²)', inp('m2', l.m2, 'type="number" min="0" step="0.5"'), false, 'Vacío o 0 si no se conoce.') +
      campo('Rubro', sel('rubro', D.listas.rubros, l.rubro, '— sin rubro —')) + campo('Sector', sel('sector', D.listas.sectores, l.sector, '— sin sector —')) +
      campo('Observaciones', '<textarea name="observaciones">' + esc(l.observaciones) + '</textarea>', true),
      function (fd) { fd.id_local = l.id_local; return API.guardarLocal(fd); });
  }

  function formContrato(l, c) {
    var esNuevo = !c; c = c || { estado_contrato: 'VIGENTE', fecha_inicio: HOY, indice_ajuste: 'IPC', periodicidad_meses: 3 };
    abrirModal(esNuevo ? 'Nuevo contrato · ' + l.nombre : 'Editar contrato ' + c.id_contrato,
      campo('Inquilino (razón social)', inp('inquilino', c.inquilino, 'required'), true) +
      campo('CUIT', inp('cuit', c.cuit, 'placeholder="30-12345678-9"')) + campo('Contacto', inp('contacto', c.contacto, 'placeholder="Nombre · teléfono"')) +
      campo('Fecha de inicio', inp('fecha_inicio', c.fecha_inicio, 'type="date" required')) + campo('Fecha de fin', inp('fecha_fin', c.fecha_fin, 'type="date" required')) +
      campo('Alquiler mensual ($)', inp('monto_alquiler', c.monto_alquiler, 'type="number" min="1" step="1" required')) + campo('Expensas mensuales ($)', inp('expensas_mensuales', c.expensas_mensuales || 0, 'type="number" min="0" step="1"')) +
      campo('Índice de ajuste', sel('indice_ajuste', D.listas.indices_ajuste, c.indice_ajuste)) + campo('Cada cuántos meses', sel('periodicidad_meses', [1, 2, 3, 4, 6, 12], String(c.periodicidad_meses))) +
      campo('Próximo ajuste', inp('proxima_fecha_ajuste', c.proxima_fecha_ajuste, 'type="date"'), false, 'La app avisa 30 días antes.') + campo('Depósito / garantía ($)', inp('deposito', c.deposito || 0, 'type="number" min="0" step="1"')) +
      campo('Observaciones', '<textarea name="observaciones">' + esc(c.observaciones) + '</textarea>', true) +
      (esNuevo ? '<div class="confirm aviso aviso-ok">Al guardar, el local pasa a <strong>ALQUILADO</strong> automáticamente.</div>' : ''),
      function (fd) { fd.id_local = l.id_local; if (!esNuevo) fd.id_contrato = c.id_contrato; return API.guardarContrato(fd); });
  }

  function formCerrarContrato(l, c) {
    var r = resumenLocal(l);
    abrirModal('Finalizar contrato · ' + c.inquilino,
      campo('Motivo', sel('estado_contrato', ['FINALIZADO', 'RESCINDIDO'], 'FINALIZADO'), true, 'FINALIZADO: llegó a término. RESCINDIDO: se cortó antes.') +
      campo('Fecha de fin efectiva', inp('fecha_fin', HOY < c.fecha_fin ? HOY : c.fecha_fin, 'type="date" required'), true) +
      (r.totalDeuda > 0 ? '<div class="confirm aviso">Atención: este local debe <strong>' + fmtMonto(r.totalDeuda) + '</strong>. Las cuotas impagas siguen registradas después de cerrar el contrato.</div>' : '') +
      '<div class="confirm aviso aviso-ok">El local pasa a <strong>LIBRE</strong>. Esta acción queda registrada en el historial.</div>',
      function (fd) { fd.id_local = l.id_local; fd.id_contrato = c.id_contrato; return API.guardarContrato(fd); }, 'Confirmar cierre');
  }

  function formPago(l, idCuotaPre) {
    var abiertas = D.cuotas.filter(function (q) { return q.id_local === l.id_local && q.estado !== 'PAGADA'; }).sort(function (a, b) { return a.periodo < b.periodo ? -1 : 1; });
    if (!abiertas.length) { toast('No hay cuotas pendientes en este local.'); return; }
    var opts = abiertas.map(function (q) { return '<option value="' + q.id_cuota + '" data-saldo="' + REGLAS.saldoCuota(D, q) + '"' + (q.id_cuota === idCuotaPre ? ' selected' : '') + '>' + q.concepto + ' ' + fmtPeriodo(q.periodo) + ' · saldo ' + fmtMonto(REGLAS.saldoCuota(D, q)) + (q.vencimiento < HOY ? ' · VENCIDA' : '') + '</option>'; }).join('');
    abrirModal('Registrar pago · ' + l.nombre,
      campo('Cuota', '<select name="id_cuota" id="sel-cuota">' + opts + '</select>', true, 'Solo se muestran cuotas pendientes o con saldo.') +
      campo('Monto ($)', inp('monto', '', 'type="number" min="1" step="1" required id="inp-monto"'), false, 'Precargado con el saldo. Bajalo si es un pago parcial.') +
      campo('Fecha de pago', inp('fecha', HOY, 'type="date" required')) +
      campo('Medio', sel('medio', D.listas.medios_pago, D.listas.medios_pago[0])) + campo('Comprobante / referencia', inp('comprobante', '')) +
      campo('Observaciones', inp('observaciones', ''), true),
      function (fd) { return API.registrarPago(fd); }, 'Registrar pago');
    var s = $('sel-cuota'), m = $('inp-monto');
    var sync = function () { var o = s.options[s.selectedIndex]; m.value = o.dataset.saldo; m.max = o.dataset.saldo; };
    s.onchange = sync; sync();
  }

  function formMant(l, m) {
    var esNueva = !m; m = m || { prioridad: 'MEDIA', estado: 'PENDIENTE', fecha_reporte: HOY, tipo_falla: D.listas.tipos_falla[0] };
    abrirModal(esNueva ? 'Reportar falla · ' + l.nombre : 'Falla ' + m.id_mant + ' · ' + l.nombre,
      campo('Tipo de falla', sel('tipo_falla', D.listas.tipos_falla, m.tipo_falla)) + campo('Prioridad', sel('prioridad', REGLAS.PRIORIDADES, m.prioridad)) +
      campo('Descripción', '<textarea name="descripcion" required>' + esc(m.descripcion) + '</textarea>', true) +
      campo('Fecha de reporte', inp('fecha_reporte', m.fecha_reporte, 'type="date" required')) + campo('Estado', sel('estado', REGLAS.ESTADOS_MANT, m.estado, undefined, 'id="sel-estado-mant"')) +
      campo('Quién intervino', sel('quien_intervino', D.listas.intervinientes, m.quien_intervino, '— todavía nadie —', 'id="sel-quien"'), false, 'Obligatorio para marcarla RESUELTA.') + campo('Costo ($)', inp('costo', m.costo, 'type="number" min="0" step="1"'), false, 'Dejar vacío si no aplica.') +
      campo('Observaciones', '<textarea name="observaciones">' + esc(m.observaciones) + '</textarea>', true),
      function (fd) { fd.id_local = l.id_local; if (!esNueva) fd.id_mant = m.id_mant; return API.guardarMantenimiento(fd); });
    var se = $('sel-estado-mant'), sq = $('sel-quien');
    var sync = function () { sq.required = se.value === 'RESUELTO'; };
    se.onchange = sync; sync();
  }

  function formCuotas() {
    var per = periodoActual();
    var pers = []; var d = new Date(HOY + 'T00:00:00');
    for (var i = -2; i <= 2; i++) { var x = new Date(d.getFullYear(), d.getMonth() + i, 1); pers.push(x.getFullYear() + '-' + (x.getMonth() + 1 < 10 ? '0' : '') + (x.getMonth() + 1)); }
    var vig = D.contratos.filter(function (c) { return c.estado_contrato === 'VIGENTE'; }).length;
    abrirModal('Generar cuotas del mes',
      campo('Período', '<select name="periodo">' + pers.map(function (p) { return '<option value="' + p + '"' + (p === per ? ' selected' : '') + '>' + fmtPeriodo(p) + '</option>'; }).join('') + '</select>', true) +
      '<div class="confirm aviso aviso-ok">Crea las cuotas de <strong>alquiler y expensas</strong> para los <strong>' + vig + '</strong> contratos vigentes, con vencimiento el día 10. Si alguna ya existe no se duplica: se puede repetir sin riesgo.</div>',
      function (fd) { return API.generarCuotas(fd); }, 'Generar');
  }

  // ---------- alertas ----------
  function renderAlertas() {
    var a = calcularAlertas();
    var h = '';
    function fila(x, urgente, derecha, sub) { return '<div class="alerta' + (urgente ? ' urgente' : '') + '" data-id="' + x.l.id_local + '" data-tab="' + (sub === 'pagos' ? 'pagos' : 'contrato') + '"><div><div class="t">' + esc(x.l.nombre) + ' · ' + esc(x.r.contrato ? x.r.contrato.inquilino : '') + '</div><div class="s">' + nombrePlanta(x.l.planta) + '</div></div><div class="d">' + derecha + '</div></div>'; }
    h += '<div class="alerta-grupo"><h3>Contratos por vencer (' + a.vencimientos.length + ')</h3>' + (a.vencimientos.length ? a.vencimientos.map(function (x) { return fila(x, x.dias <= 30, x.dias < 0 ? 'vencido' : x.dias + ' días<br><span style="font-weight:400;font-size:.78rem">' + fmtFecha(x.r.contrato.fecha_fin) + '</span>'); }).join('') : '<div class="vacio">Ninguno en los próximos ' + Math.max.apply(null, CONFIG.ALERTA_VENCIMIENTO) + ' días.</div>') + '</div>';
    h += '<div class="alerta-grupo"><h3>Ajustes próximos (' + a.ajustes.length + ')</h3>' + (a.ajustes.length ? a.ajustes.map(function (x) { return fila(x, x.dias <= 7, (x.dias < 0 ? 'atrasado ' + (-x.dias) : x.dias) + ' días<br><span style="font-weight:400;font-size:.78rem">' + esc(x.r.contrato.indice_ajuste) + ' · ' + fmtFecha(x.r.contrato.proxima_fecha_ajuste) + '</span>'); }).join('') : '<div class="vacio">Ninguno en los próximos ' + CONFIG.ALERTA_AJUSTE + ' días.</div>') + '</div>';
    h += '<div class="alerta-grupo"><h3>En mora (' + a.mora.length + ')</h3>' + (a.mora.length ? a.mora.map(function (x) { return fila(x, x.r.deuda.ALQUILER.meses >= 2, fmtMonto(x.r.totalDeuda) + '<br><span style="font-weight:400;font-size:.78rem">' + descDeuda(x.r.deuda) + '</span>', 'pagos'); }).join('') : '<div class="vacio">Nadie debe.</div>') + '</div>';
    h += '<div class="alerta-grupo"><h3>Fallas de prioridad ALTA (' + a.fallas.length + ')</h3>' + (a.fallas.length ? a.fallas.map(function (m) { var l = D.locales.filter(function (x) { return x.id_local === m.id_local; })[0]; return '<div class="alerta urgente" data-id="' + (l ? l.id_local : '') + '" data-tab="mantenimiento"><div><div class="t">' + esc(l ? l.nombre : 'Área común') + ' · ' + esc(m.tipo_falla) + '</div><div class="s">' + esc(m.descripcion) + '</div></div><div class="d">' + esc(m.estado) + '</div></div>'; }).join('') : '<div class="vacio">Ninguna.</div>') + '</div>';
    $('alertas-cuerpo').innerHTML = h;
    $('alertas-cuerpo').querySelectorAll('.alerta[data-id]').forEach(function (el) { el.onclick = function () { if (el.dataset.id) { $('panel-alertas').hidden = true; abrirFicha(el.dataset.id, el.dataset.tab); } }; });
  }

  // ---------- ayuda ----------
  function mostrarAyuda() {
    abrirModal('Cómo se usa',
      '<div class="ayuda-texto ancho campo">' +
      '<h3>El mapa</h3><p>Cada local aparece dibujado sobre el plano. El color dice cómo está: <strong>gris</strong> libre, <strong>teal</strong> alquilado y al día, <strong>naranja</strong> alquilado con deuda, <strong>azul rayado</strong> en refacción, <strong>violeta rayado</strong> en gestión judicial, <strong>gris claro</strong> de uso interno (no se alquila). El ícono 🔧 marca que tiene un trabajo de mantenimiento sin resolver, sea cual sea su color. Una zona punteada es una habitación del plano que todavía no tiene unidad asignada.</p>' +
      '<p>No todo está en el plano: las <strong>góndolas</strong> del hall, las <strong>oficinas de planta alta</strong> y el <strong>predio norte</strong> aparecen solo en la lista de la izquierda (filtrá por categoría). Una unidad puede ocupar varias zonas del plano (por ejemplo 41A y 41B).</p>' +
      '<p>Arriba del plano están los <strong>sectores</strong> (Block 1 a 8): al elegir uno el mapa hace zoom ahí y la lista de la izquierda muestra solo esos locales. También podés acercar con la rueda del mouse (o dos dedos en el celular), arrastrar para moverte y volver a la vista del sector con ⌂.</p>' +
      '<h3>La ficha</h3><p>Hacé click en un local (en el plano o en la lista de la izquierda) y se abre su ficha con cinco pestañas: Resumen, Contrato, Pagos, Mantenimiento e Historial. Desde ahí se edita todo.</p>' +
      '<h3>Qué se carga a mano y qué no</h3><ul><li>El estado <strong>ALQUILADO</strong> lo pone la app sola cuando cargás un contrato, y lo saca cuando lo finalizás. No se puede forzar.</li><li>La <strong>deuda</strong> se calcula con las cuotas vencidas sin pagar. Para que un local figure al día, registrá el pago.</li><li>Lo único que marcás vos es <strong>LIBRE</strong> o <strong>EN REFACCIÓN</strong> (botón Editar en Resumen).</li></ul>' +
      '<h3>Todos los meses</h3><p>Apretá <strong>+ Cuotas del mes</strong>. Crea la cuota de alquiler y la de expensas de cada contrato vigente, con vencimiento el 10. Si ya estaban, no las duplica.</p>' +
      '<h3>Registrar un pago</h3><p>Ficha → Pagos → <strong>+ Registrar pago</strong>, o click directo en la fila de la cuota. El monto viene precargado con el saldo; bajalo si es un pago parcial.</p>' +
      '<h3>Mantenimiento</h3><p>Ficha → Mantenimiento → <strong>+ Reportar falla</strong>. Cuando se resuelve, actualizala a RESUELTO indicando quién intervino y el costo si lo hubo.</p>' +
      '<h3>Alertas 🔔</h3><p>Contratos que vencen en 30/60/90 días, ajustes de alquiler próximos, locales en mora y fallas de prioridad ALTA. Click en una alerta te lleva al local.</p>' +
      '<h3>Buscar y filtrar</h3><p>El buscador acepta nombre del local, inquilino, rubro o sector. Los chips filtran por situación; el plano atenúa los locales que no coinciden.</p>' +
      '</div>', function () { return Promise.resolve({ mensaje: '' }); }, 'Cerrar');
    $('modal-cancelar').hidden = true;
  }

  // ---------- diagnóstico del esquema (viene del backend) ----------
  function mostrarDiagnostico(diag) {
    var b = $('banner-diagnostico');
    if (!diag || !diag.length) { b.hidden = true; return; }
    b.innerHTML = '<strong>Atención: la planilla no coincide con lo que la app espera.</strong> Algunos datos pueden faltar o verse mal.<ul>' + diag.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>';
    b.hidden = false;
  }

  // ---------- arranque ----------
  async function iniciar() {
    $('app').hidden = false; $('pantalla-pin').hidden = true;
    $('banner-demo').hidden = !API.modoDemo;
    try {
      var resp = await API.cargarTodo();
      D = resp.datos;
      mostrarDiagnostico(resp.diagnostico);
    } catch (e) {
      if (/PIN/i.test(e.message)) { mostrarPin(e.message); return; }
      $('mapa').innerHTML = '<div class="cargando">No se pudieron cargar los datos: ' + esc(e.message) + '</div>';
      return;
    }
    await cargarPlano();
    renderTodo();
  }
  function mostrarPin(msg) {
    $('app').hidden = true; $('pantalla-pin').hidden = false;
    $('pin-error').hidden = !msg; $('pin-error').textContent = msg || '';
    $('input-pin').value = ''; $('input-pin').focus();
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('nombre-edificio').textContent = CONFIG.NOMBRE_EDIFICIO; $('pin-edificio').textContent = CONFIG.NOMBRE_EDIFICIO;
    $('pin-nota').hidden = !API.modoDemo;
    $('form-pin').onsubmit = async function (ev) {
      ev.preventDefault();
      var btn = $('form-pin').querySelector('button'); btn.disabled = true;
      try { await API.validarPin($('input-pin').value.trim()); await iniciar(); }
      catch (e) { $('pin-error').textContent = e.message; $('pin-error').hidden = false; $('input-pin').value = ''; $('input-pin').focus(); }
      btn.disabled = false;
    };
    $('btn-salir').onclick = function () { API.salir(); mostrarPin(''); };
    $('btn-ayuda').onclick = mostrarAyuda;
    $('btn-cuotas').onclick = formCuotas;
    $('btn-alertas').onclick = function () { renderAlertas(); $('ficha').hidden = true; $('panel-alertas').hidden = false; $('ficha-fondo').hidden = false; };
    $('alertas-cerrar').onclick = function () { $('panel-alertas').hidden = true; $('ficha-fondo').hidden = true; };
    $('ficha-cerrar').onclick = cerrarFicha;
    $('ficha-fondo').onclick = function () { cerrarFicha(); $('panel-alertas').hidden = true; };
    $('modal-cerrar').onclick = cerrarModal;
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) cerrarModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!$('modal').hidden) cerrarModal(); else if (!$('ficha').hidden) cerrarFicha(); else if (!$('panel-alertas').hidden) { $('panel-alertas').hidden = true; $('ficha-fondo').hidden = true; } } });
    $('ficha-tabs').querySelectorAll('button').forEach(function (b) { b.onclick = function () { tabFicha = b.dataset.tab; renderFicha(); }; });
    $('buscador').oninput = function () { textoBusqueda = $('buscador').value.trim(); renderLista(); pintarMapa(); };
    $('zoom-mas').onclick = function () { zoomEn(1.5); };
    $('zoom-menos').onclick = function () { zoomEn(1 / 1.5); };
    $('zoom-reset').onclick = function () { if (vistaSector) setViewBox(cajaSector(sectorActual)); };
    window.addEventListener('resize', function () { if (vistaBase) { vistaSector = cajaSector(sectorActual); setViewBox(vistaSector); } });

    if (API.tienePin()) iniciar(); else mostrarPin('');
  });
})();
