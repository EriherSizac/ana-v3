/**
 * Genera un delay aleatorio entre min y max ms, con distribución normal centrada en el rango medio
 * Para 30-120s con pico en 60-80s, usa Box-Muller transform
 */
function getRandomDelayWithNormalDistribution(min, max, peakMin, peakMax) {
  // Convertir todo a segundos para facilitar cálculos
  const minSec = min / 1000;
  const maxSec = max / 1000;
  const peakMinSec = peakMin / 1000;
  const peakMaxSec = peakMax / 1000;
  
  // Media y desviación estándar para distribución normal
  const mean = (peakMinSec + peakMaxSec) / 2; // 70 segundos
  const stdDev = (peakMaxSec - peakMinSec) / 2; // ~10 segundos
  
  // Box-Muller transform para generar número con distribución normal
  let u1 = Math.random();
  let u2 = Math.random();
  let z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  
  // Convertir a nuestra distribución
  let result = mean + z0 * stdDev;
  
  // Clamp entre min y max
  result = Math.max(minSec, Math.min(maxSec, result));
  
  // Convertir de vuelta a milisegundos
  return Math.round(result * 1000);
}

export const CONSTANTS = {
  // Delay entre contactos: 30-120s con pico en 60-80s
  MIN_DELAY_MS: 30000,  // 30 segundos
  MAX_DELAY_MS: 120000, // 120 segundos
  PEAK_MIN_MS: 60000,   // 60 segundos (inicio del pico)
  PEAK_MAX_MS: 80000,   // 80 segundos (fin del pico)
  
  // Función para obtener el delay aleatorio
  getRandomDelay() {
    return getRandomDelayWithNormalDistribution(
      this.MIN_DELAY_MS,
      this.MAX_DELAY_MS,
      this.PEAK_MIN_MS,
      this.PEAK_MAX_MS
    );
  },
  
  PAUSE_AFTER_MESSAGES: 20,
};
