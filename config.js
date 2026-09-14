// ============================================================
//  CONFIGURACIÓN DEL FRONTEND — el único archivo que hay que tocar
//  para pasar de los datos de prueba a los reales.
// ============================================================
const CONFIG = {
  // URL del deployment de Apps Script (termina en /exec).
  // Vacío = modo demostración: lee mock/datos.json y los cambios viven solo en esta pestaña.
  API_URL: 'https://script.google.com/macros/s/AKfycbwzkDwZyq2TfONn8pU7k4wmicCGSp7xWNueG4TouFFjqqungnDI1Z7IRnLX4qP9yq5n/exec',

  // PIN que acepta el modo demostración. En modo API el PIN lo valida el servidor.
  MOCK_PIN: '1234',

  // Plantas del edificio. `archivo` es el SVG con una zona id="L-XX" por local
  // (generado por herramientas/extraer-plano.py a partir del plano CONFORME A OBRA 2026).
  PLANTAS: [
    { id: 'PB', nombre: 'Planta baja', archivo: 'planos/planta-baja.svg' },
  ],

  // Sectores del edificio (valor del campo `sector` de cada local). El mapa arma una vista
  // con zoom por sector a partir de las zonas de sus locales; no hace falta cargar coordenadas.
  SECTORES: ['Block 1', 'Block 2', 'Block 3', 'Block 4', 'Block 5', 'Block 6', 'Block 7', 'Block 8'],

  // Umbrales de alertas (días)
  ALERTA_VENCIMIENTO: [30, 60, 90],
  ALERTA_AJUSTE: 30,

  NOMBRE_EDIFICIO: 'Terminal de Ómnibus · INGECO S.A.',
};
