// Formato de importes y fechas para los textos y PDF que genera la aplicación

const formatoEuros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

// 1250 → "12,50 €"
export const euros = (centimos: number) => formatoEuros.format(centimos / 100)

// "2026-10-20" → "20/10/2026"
export const fechaCorta = (fecha: string) => fecha.split('-').reverse().join('/')
