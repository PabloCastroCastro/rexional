import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { api, datos } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Selector } from '../componentes/Selector'
import { hoy, textoFecha } from '../entrenos/datos'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { type CalendarioLeido, type FilaCalendario, leerCalendario, partidosDe } from './calendario'
import { CLAVE_PARTIDOS } from './datos'
import estilos from './Partidos.module.css'

// Importar el calendario de la competición: se sube el PDF de la federación, se elige el equipo y
// se revisan sus partidos antes de crearlos. Solo se registran la fecha de la jornada, el rival y
// si es en casa o fuera.

// Por defecto se eligen los partidos que faltan por jugar y no están ya en la aplicación
const elegidosPorDefecto = (filas: FilaCalendario[]) =>
  new Set(filas.filter((f) => f.partido && !f.yaEsta && f.fecha >= hoy()).map((f) => f.jornada))

export function PaginaCalendario() {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const { avisar } = useAvisos()
  const entrada = useRef<HTMLInputElement>(null)
  const [calendario, setCalendario] = useState<CalendarioLeido | null>(null)
  const [equipo, setEquipo] = useState('')
  const [elegidos, setElegidos] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const lista = `/plantillas/${plantilla.id}/partidos`

  const filas = calendario && equipo ? partidosDe(calendario, equipo) : []

  const elegirEquipo = (cal: CalendarioLeido, nombre: string) => {
    setEquipo(nombre)
    setElegidos(nombre ? elegidosPorDefecto(partidosDe(cal, nombre)) : new Set())
  }

  const leer = useMutation({
    mutationFn: (archivo: File) => leerCalendario(plantilla.id, archivo),
    onMutate: () => setError(null),
    onSuccess: (leido) => {
      setCalendario(leido)
      elegirEquipo(leido, leido.equipo ?? '')
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido leer el calendario'),
  })

  const importar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/plantillas/{id}/partidos/calendario', {
          params: { path: { id: plantilla.id } },
          body: {
            partidos: filas.flatMap((f) =>
              f.partido && elegidos.has(f.jornada)
                ? [{ fecha: f.fecha, rival: f.partido.rival, local: f.partido.local }]
                : [],
            ),
          },
        }),
      ),
    onSuccess: async ({ creados, omitidos }) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_PARTIDOS })
      avisar({
        tipo: 'exito',
        mensaje: [
          creados === 1 ? 'Se ha creado 1 partido' : `Se han creado ${creados} partidos`,
          omitidos.length > 0 &&
            (omitidos.length === 1 ? '1 ya estaba' : `${omitidos.length} ya estaban`),
        ]
          .filter(Boolean)
          .join('; '),
      })
      navegar(lista)
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'No se han podido crear los partidos'),
  })

  if (!puedeGestionarJugadores(plantilla)) return <Navigate to={lista} replace />

  const alternar = (jornada: number) => {
    const nuevos = new Set(elegidos)
    if (!nuevos.delete(jornada)) nuevos.add(jornada)
    setElegidos(nuevos)
  }

  const subir = (
    <>
      <input
        ref={entrada}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        aria-label="Archivo del calendario en PDF"
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          e.target.value = ''
          if (archivo) leer.mutate(archivo)
        }}
      />
      <Boton
        variante={calendario ? 'secundario' : 'primario'}
        icono={<FileUp aria-hidden size={18} />}
        cargando={leer.isPending}
        onClick={() => entrada.current?.click()}
      >
        {calendario ? 'Elegir otro PDF' : 'Elegir el PDF'}
      </Boton>
    </>
  )

  return (
    <div className={estilos.pagina}>
      <Link to={lista} className={estilos.volver}>
        <ChevronLeft aria-hidden size={20} />
        Partidos
      </Link>
      <header className={estilos.ficha}>
        {calendario && (
          <span className={estilos.cuando}>
            {[calendario.competicion, calendario.temporada && `Temporada ${calendario.temporada}`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        <h1>Importar calendario</h1>
      </header>

      {!calendario && (
        <p className={estilos.secundario}>
          Sube el calendario de la competición en PDF de la federación. Se crean los partidos de tu
          equipo con la fecha de cada jornada, el rival y si se juega en casa o fuera; la hora y el
          campo los pones después en cada partido.
        </p>
      )}
      {error && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      <div className={estilos.acciones}>{subir}</div>

      {calendario && (
        <>
          <Selector
            etiqueta="Tu equipo"
            value={equipo}
            onChange={(e) => elegirEquipo(calendario, e.target.value)}
          >
            <option value="">Elige tu equipo</option>
            {calendario.equipos.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Selector>

          {equipo && (
            <>
              <div className={estilos.barraConvocatoria}>
                <p role="status" aria-live="polite">
                  <strong>{elegidos.size}</strong> de {filas.filter((f) => f.partido).length}{' '}
                  partidos elegidos
                </p>
              </div>
              <ul className={estilos.seleccion} aria-label="Partidos del calendario">
                {filas.map((f) =>
                  f.partido ? (
                    <li key={f.jornada} data-convocado={elegidos.has(f.jornada)}>
                      <label>
                        <input
                          type="checkbox"
                          checked={elegidos.has(f.jornada)}
                          onChange={() => alternar(f.jornada)}
                        />
                        <span className={estilos.casilla} aria-hidden="true">
                          {elegidos.has(f.jornada) && <Check size={20} />}
                        </span>
                        <span className={estilos.texto}>
                          <span className={estilos.nombre}>
                            {f.partido.local ? 'vs ' : 'en '}
                            {f.partido.rival}
                          </span>
                          <span className={estilos.secundario}>
                            {[
                              `Jornada ${f.jornada}`,
                              textoFecha(f.fecha),
                              f.partido.local ? 'Casa' : 'Fuera',
                              f.yaEsta ? 'Ya está' : f.fecha < hoy() && 'Ya pasó',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                      </label>
                    </li>
                  ) : (
                    <li key={f.jornada} data-convocado="false">
                      <span className={estilos.descanso}>
                        Jornada {f.jornada} · {textoFecha(f.fecha)} · Descansa
                      </span>
                    </li>
                  ),
                )}
              </ul>
              <div className={estilos.pieFijo}>
                <Boton variante="secundario" onClick={() => navegar(lista)}>
                  Cancelar
                </Boton>
                <Boton
                  disabled={elegidos.size === 0}
                  cargando={importar.isPending}
                  onClick={() => importar.mutate()}
                >
                  {elegidos.size === 1 ? 'Crear 1 partido' : `Crear ${elegidos.size} partidos`}
                </Boton>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
