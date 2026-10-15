import { useQuery } from '@tanstack/react-query'
import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'

export type Entreno = components['schemas']['Entreno']
export type JugadorEntreno = Entreno['jugadores'][number]
export type Estado = NonNullable<JugadorEntreno['estado']>

// Entrenos, asistencias y resúmenes cuelgan de esta clave, para refrescarlos juntos tras guardar
export const CLAVE_ENTRENOS = ['entrenos'] as const

export const claveEntreno = (plantillaId: string, entrenoId: string) =>
  [...CLAVE_ENTRENOS, plantillaId, 'entreno', entrenoId] as const

// Un entreno con su lista
export const useEntreno = (plantillaId: string, entrenoId: string | undefined) =>
  useQuery({
    queryKey: claveEntreno(plantillaId, entrenoId ?? ''),
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/entrenos/{eid}', {
          params: { path: { id: plantillaId, eid: entrenoId ?? '' } },
        }),
      ),
    enabled: entrenoId !== undefined,
  })

// Entrenos de un día (varios si hay doble sesión), por hora
export const useEntrenosDelDia = (plantillaId: string, fecha: string) =>
  useQuery({
    queryKey: [...CLAVE_ENTRENOS, plantillaId, 'dia', fecha],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/entrenos', {
          params: { path: { id: plantillaId }, query: { desde: fecha, hasta: fecha } },
        }),
      ),
  })

// --- Fechas: siempre AAAA-MM-DD en Europe/Madrid, la zona horaria de la aplicación ---

export const hoy = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

export const sumarDias = (fecha: string, dias: number) =>
  new Date(new Date(`${fecha}T12:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10)

export const esFechaValida = (fecha: string | null): fecha is string =>
  fecha !== null &&
  /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
  !Number.isNaN(Date.parse(`${fecha}T12:00:00Z`)) &&
  new Date(`${fecha}T12:00:00Z`).toISOString().startsWith(fecha)

const formatoDia = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

// "Hoy · martes, 13 oct", "Ayer · lunes, 12 oct", "jueves, 8 oct"
export function textoFecha(fecha: string) {
  const dia = formatoDia.format(new Date(`${fecha}T12:00:00Z`))
  const actual = hoy()
  if (fecha === actual) return `Hoy · ${dia}`
  if (fecha === sumarDias(actual, -1)) return `Ayer · ${dia}`
  return dia
}

export type ResumenEntreno = components['schemas']['ResumenEntreno']
export type AsistenciaJugador = components['schemas']['AsistenciaJugador']

// Entrenos hasta hoy (los próximos se muestran con el calendario, GH-82)
export const useHistorial = (plantillaId: string) =>
  useQuery({
    queryKey: [...CLAVE_ENTRENOS, plantillaId, 'historial'],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/entrenos', {
          params: { path: { id: plantillaId }, query: { hasta: hoy() } },
        }),
      ),
  })

// Asistencia por jugador (el rol jugador solo recibe la suya)
export const useResumenAsistencia = (plantillaId: string) =>
  useQuery({
    queryKey: [...CLAVE_ENTRENOS, plantillaId, 'resumen'],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/asistencia/resumen', {
          params: { path: { id: plantillaId } },
        }),
      ),
  })

const formatoMes = new Intl.DateTimeFormat('es-ES', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

// "octubre de 2026"
export const textoMes = (fecha: string) => formatoMes.format(new Date(`${fecha}T12:00:00Z`))

// "20:00–21:30", "20:00" o null si no tiene hora
export const textoHoras = (e: { hora: string | null; horaFin?: string | null }) =>
  e.hora ? (e.horaFin ? `${e.hora}–${e.horaFin}` : e.hora) : null

// --- Calendario: horario semanal, próximos entrenos ---

// El esquema admite null (plantilla sin horario)
export type Horario = NonNullable<components['schemas']['Horario']>
export type SesionHorario = components['schemas']['SesionHorario']

export const useHorario = (plantillaId: string) =>
  useQuery({
    queryKey: [...CLAVE_ENTRENOS, plantillaId, 'horario'],
    queryFn: () =>
      datos(api.GET('/api/plantillas/{id}/horario', { params: { path: { id: plantillaId } } })),
  })

// Los próximos entrenos, del más cercano al más lejano
export const useProximos = (plantillaId: string, cuantos = 5) =>
  useQuery({
    queryKey: [...CLAVE_ENTRENOS, plantillaId, 'proximos'],
    queryFn: async () => {
      const futuros = await datos(
        api.GET('/api/plantillas/{id}/entrenos', {
          params: { path: { id: plantillaId }, query: { desde: sumarDias(hoy(), 1) } },
        }),
      )
      // La API los da del más lejano al más cercano y, dentro de un día, por hora
      return [...futuros]
        .sort(
          (a, b) => a.fecha.localeCompare(b.fecha) || (a.hora ?? '').localeCompare(b.hora ?? ''),
        )
        .slice(0, cuantos)
    },
  })

// Día de la semana ISO: 1 lunes … 7 domingo
export const diaSemana = (fecha: string) => new Date(`${fecha}T12:00:00Z`).getUTCDay() || 7

// Cuántos entrenos crea un horario al guardarlo: los de las fechas entre «desde» (o hoy, si es
// anterior) y «hasta» cuyo día de la semana tiene sesión. La misma regla que la API.
export function entrenosDelHorario(
  horario: { desde: string; hasta: string; sesiones: SesionHorario[] },
  actual = hoy(),
) {
  let total = 0
  const inicio = horario.desde > actual ? horario.desde : actual
  for (let fecha = inicio; fecha <= horario.hasta; fecha = sumarDias(fecha, 1)) {
    total += horario.sesiones.filter((s) => s.dia === diaSemana(fecha)).length
  }
  return total
}

// Último día por defecto de un horario: el 30 de junio de la temporada (2026-27 → 2027-06-30)
export const finDeTemporada = (temporada: string) => `${Number(temporada.slice(0, 4)) + 1}-06-30`

const formatoCorto = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})

// "15 de octubre"
export const textoDiaMes = (fecha: string) => formatoCorto.format(new Date(`${fecha}T12:00:00Z`))
