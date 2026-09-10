// ============================================================
//  CONFIGURACIÓN DEL FRONTEND — el único archivo que hay que tocar
//  para pasar de los datos ficticios a los reales.
// ============================================================
const CONFIG = {
  // URL del deployment de Apps Script (termina en /exec).
  // Vacío = modo demostración: lee mock/datos.json y los cambios viven solo en esta pestaña.
  API_URL: '',

  // PIN que acepta el modo demostración. En modo API el PIN lo valida el servidor.
  MOCK_PIN: '1234',

  // Plantas del edificio. `archivo` es el SVG con una zona id="L-XX" por local.
  PLANTAS: [
    { id: 'PB', nombre: 'Planta baja', archivo: 'planos/planta-baja.svg' },
    { id: 'PA', nombre: 'Planta alta', archivo: 'planos/planta-alta.svg' },
  ],

  // Umbrales de alertas (días)
  ALERTA_VENCIMIENTO: [30, 60, 90],
  ALERTA_AJUSTE: 30,

  NOMBRE_EDIFICIO: 'Terminal de Ómnibus · INGECO S.A.',
};
