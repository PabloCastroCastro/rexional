import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'

// Calendario de la competición en PDF (GH-127): lo leído y, para el equipo elegido, sus partidos

export type CalendarioLeido = components['schemas']['CalendarioLeido']

// Lee el PDF sin crear nada
export const leerCalendario = (plantillaId: string, archivo: File) =>
  datos(
    api.POST('/api/plantillas/{id}/partidos/calendario/leer', {
      params: { path: { id: plantillaId } },
      // El contrato lo describe como binario (string): se envía el archivo en un formulario
      body: { archivo: archivo.name },
      bodySerializer: () => {
        const formulario = new FormData()
        formulario.append('archivo', archivo)
        return formulario
      },
    }),
  )

// Comparación de nombres de equipos: la misma que en el backend (src/calendario/equipos.ts), para
// marcar en la vista previa los partidos que ya están
const GENERICAS = new Set([
  'CLUB',
  'CD',
  'SD',
  'SDC',
  'CF',
  'FC',
  'UD',
  'CP',
  'SC',
  'AD',
  'DE',
  'DEL',
  'LA',
  'EL',
  'LOS',
  'LAS',
])

const palabrasEquipo = (nombre: string) =>
  new Set(
    nombre
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toUpperCase()
      .replace(/\b([A-Z])\.(?=[A-Z]\.)/g, '$1')
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(' ')
      .filter((p) => p.length > 1 && !GENERICAS.has(p)),
  )

const parecido = (a: string, b: string) => {
  const pa = palabrasEquipo(a)
  return [...palabrasEquipo(b)].filter((p) => pa.has(p)).length
}

const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000

export const yaRegistrado = (
  nuevo: { fecha: string; rival: string },
  existentes: { fecha: string; rival: string }[],
) =>
  existentes.some(
    (e) =>
      e.fecha === nuevo.fecha ||
      (dias(e.fecha, nuevo.fecha) <= 3 && parecido(e.rival, nuevo.rival) > 0),
  )

export type FilaCalendario = {
  jornada: number
  fecha: string
  // null si el equipo descansa esa jornada
  partido: { rival: string; local: boolean } | null
  yaEsta: boolean
}

// Las jornadas desde el punto de vista de un equipo
export function partidosDe(calendario: CalendarioLeido, equipo: string): FilaCalendario[] {
  return calendario.jornadas.map((j) => {
    const e = j.enfrentamientos.find((x) => x.local === equipo || x.visitante === equipo)
    const partido = e
      ? { rival: e.local === equipo ? e.visitante : e.local, local: e.local === equipo }
      : null
    return {
      jornada: j.numero,
      fecha: j.fecha,
      partido,
      yaEsta: partido
        ? yaRegistrado({ fecha: j.fecha, rival: partido.rival }, calendario.existentes)
        : false,
    }
  })
}
