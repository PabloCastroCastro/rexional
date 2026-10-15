import { config } from './config.js'

// Fechas como texto AAAA-MM-DD en la zona horaria de la aplicación (Europe/Madrid), igual que las
// guarda PostgreSQL en las columnas date.

// Día de hoy
export const hoy = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: config.zonaHoraria }).format(new Date())

export const sumarDias = (fecha: string, dias: number) =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)

const formatoDia = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})

// "Domingo, 18 de octubre"
export function textoDia(fecha: string) {
  const texto = formatoDia.format(new Date(`${fecha}T12:00:00Z`))
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}
