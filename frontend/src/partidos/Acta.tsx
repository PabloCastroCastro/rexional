import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  CircleAlert,
  FileCheck,
  FileText,
  FileUp,
  Goal,
  RectangleVertical,
  Users,
} from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, datos } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { textoFecha } from '../entrenos/datos'
import { nombreCompleto, puedeGestionarJugadores, useJugadores } from '../jugadores/datos'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  CLAVE_PARTIDOS,
  type LecturaActa,
  type Partido,
  subirActa,
  textoResultado,
  urlActa,
  useActa,
  usePartido,
} from './datos'
import estilos from './Partidos.module.css'

// Acta del partido (la ficha en PDF de la federación): subirla, verla y, tras revisar lo leído,
// registrarla. Lo registrado se puede corregir después evento a evento.

const tamano = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`

// Botón que abre el selector de archivos y sube el PDF; al terminar lleva a la revisión
function SubirActa({ partido, texto }: { partido: Partido; texto: string }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const { avisar } = useAvisos()
  const entrada = useRef<HTMLInputElement>(null)

  const subir = useMutation({
    mutationFn: (archivo: File) => subirActa(plantilla.id, partido.id, archivo),
    onSuccess: async (leida) => {
      cliente.setQueryData([...CLAVE_PARTIDOS, plantilla.id, 'acta', partido.id], leida)
      await cliente.invalidateQueries({
        queryKey: [...CLAVE_PARTIDOS, plantilla.id, 'partido', partido.id],
      })
      navegar(`/plantillas/${plantilla.id}/partidos/${partido.id}/acta`)
    },
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido subir el acta',
      }),
  })

  return (
    <>
      <input
        ref={entrada}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        aria-label="Archivo del acta en PDF"
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          e.target.value = ''
          if (archivo) subir.mutate(archivo)
        }}
      />
      <Boton
        variante="secundario"
        icono={<FileUp aria-hidden size={18} />}
        cargando={subir.isPending}
        onClick={() => entrada.current?.click()}
      >
        {texto}
      </Boton>
    </>
  )
}

// Sección del acta en la ficha del partido
export function SeccionActa({ partido }: { partido: Partido }) {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  const importado = partido.eventos.some((e) => e.origen === 'acta')
  if (!partido.acta && !gestiona) return null

  return (
    <section className={estilos.seccion} aria-labelledby="acta">
      <h2 id="acta">
        <FileText aria-hidden size={20} />
        Acta del partido
      </h2>
      {partido.acta ? (
        <p className={estilos.secundario}>
          <a href={urlActa(plantilla.id, partido.id)} target="_blank" rel="noreferrer">
            {partido.acta.nombreArchivo}
          </a>{' '}
          · {tamano(partido.acta.tamano)} · {importado ? 'registrada' : 'sin registrar'}
        </p>
      ) : (
        <p className={estilos.secundario}>
          Sube la ficha del partido en PDF de la federación: se leen el resultado, los titulares,
          los cambios, los goles y las tarjetas, y los revisas antes de guardarlos.
        </p>
      )}
      {gestiona && (
        <div className={estilos.acciones}>
          {partido.acta && (
            <Link to="acta" className={estilos.enlaceBoton}>
              <FileCheck aria-hidden size={18} />
              {importado ? 'Revisar el acta' : 'Revisar y registrar'}
            </Link>
          )}
          <SubirActa partido={partido} texto={partido.acta ? 'Subir otra' : 'Subir acta'} />
        </div>
      )}
    </section>
  )
}

// Revisión de lo leído en el acta y registro
export function PaginaActa() {
  const plantilla = usePlantillaActiva()
  const { partidoId = '' } = useParams()
  const partido = usePartido(plantilla.id, partidoId)
  const acta = useActa(plantilla.id, partidoId)
  const activos = useJugadores(plantilla.id, true)
  const bajas = useJugadores(plantilla.id, false)
  const ficha = `/plantillas/${plantilla.id}/partidos/${partidoId}`

  const volver = (
    <Link to={ficha} className={estilos.volver}>
      <ChevronLeft aria-hidden size={20} />
      Partido
    </Link>
  )

  if (partido.isPending || acta.isPending || activos.isPending || bajas.isPending) {
    return <Cargando />
  }
  if (partido.isError || acta.isError || activos.isError || bajas.isError) {
    const error = partido.error ?? acta.error ?? activos.error ?? bajas.error
    return (
      <div className={estilos.pagina}>
        {volver}
        <EstadoVacio titulo="No se puede revisar el acta" descripcion={error?.message ?? ''} />
      </div>
    )
  }
  const lectura = acta.data.lectura
  if (!lectura) {
    return (
      <div className={estilos.pagina}>
        {volver}
        <EstadoVacio
          icono={<CircleAlert size={32} />}
          titulo="No se ha podido leer el acta"
          descripcion={`${acta.data.error ?? ''} Comprueba que es la ficha del partido de la federación en PDF.`}
          accion={<SubirActa partido={partido.data} texto="Subir otra" />}
        />
      </div>
    )
  }
  return (
    <Revision
      partido={partido.data}
      lectura={lectura}
      jugadores={[...activos.data, ...bajas.data]}
      volver={volver}
    />
  )
}

// Clave estable para listas que pueden repetir el mismo gol (dos goles del mismo jugador y minuto)
const conClave = <T,>(lista: T[], prefijo: string) =>
  lista.map((elemento, n) => ({ ...elemento, clave: `${prefijo}${n}` }))

type Tarjeta = 'amarilla' | 'roja'

type Opcion = { jugadorId: string; nombre: string; apellidos: string | null; dorsal: number | null }

function Revision({
  partido,
  lectura,
  jugadores,
  volver,
}: {
  partido: Partido
  lectura: LecturaActa
  jugadores: Opcion[]
  volver: ReactNode
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const { avisar } = useAvisos()
  const personas = [...lectura.titulares, ...lectura.suplentes]
  const [elegidos, setElegidos] = useState<Record<string, string>>(() =>
    Object.fromEntries(personas.map((p) => [p.nombre, p.jugadorId ?? ''])),
  )
  const [tipos, setTipos] = useState<Record<number, Tarjeta | ''>>(() =>
    Object.fromEntries(lectura.tarjetas.map((t, i) => [i, t.tipo ?? ''])),
  )
  const [error, setError] = useState<string | null>(null)

  const porId = new Map(jugadores.map((j) => [j.jugadorId, j]))
  // Nombre de la app del elegido para una persona del acta, o el del acta si no cuenta
  const nombreDe = (nombreActa: string) => {
    const jugador = porId.get(elegidos[nombreActa] ?? '')
    return jugador ? nombreCompleto(jugador) : nombreActa
  }
  const repetidos = new Set(
    Object.values(elegidos).filter((id, i, todos) => id && todos.indexOf(id) !== i),
  )
  const sinTipo = lectura.tarjetas.some((t, i) => elegidos[t.nombre] && !tipos[i])
  const yaImportado = partido.eventos.some((e) => e.origen === 'acta')

  const registrar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/plantillas/{id}/partidos/{pid}/acta/confirmar', {
          params: { path: { id: plantilla.id, pid: partido.id } },
          body: {
            jugadores: personas.map((p) => ({
              nombre: p.nombre,
              jugadorId: elegidos[p.nombre] || null,
            })),
            tarjetas: lectura.tarjetas.flatMap((_, indice) => {
              const tipo = tipos[indice]
              return tipo ? [{ indice, tipo }] : []
            }),
          },
        }),
      ),
    onSuccess: async (guardado) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_PARTIDOS })
      avisar({
        tipo: 'exito',
        mensaje: `Acta registrada: ${textoResultado(guardado) ?? ''} contra ${guardado.rival}`,
      })
      navegar(`/plantillas/${plantilla.id}/partidos/${partido.id}`)
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido registrar el acta'),
  })

  const elegir = (nombreActa: string, jugadorId: string) =>
    setElegidos({ ...elegidos, [nombreActa]: jugadorId })

  const fila = (p: LecturaActa['titulares'][number]) => (
    <li key={p.nombre} className={estilos.filaActa}>
      <Dorsal dorsal={p.dorsal} />
      <label className={estilos.eleccion}>
        <span className={estilos.secundario}>{p.nombre}</span>
        <select
          value={elegidos[p.nombre] ?? ''}
          onChange={(e) => elegir(p.nombre, e.target.value)}
          aria-invalid={repetidos.has(elegidos[p.nombre] ?? '') || !elegidos[p.nombre] || undefined}
        >
          <option value="">— No cuenta —</option>
          {jugadores.map((j) => (
            <option key={j.jugadorId} value={j.jugadorId}>
              {j.dorsal ?? '–'} · {nombreCompleto(j)}
            </option>
          ))}
        </select>
      </label>
    </li>
  )

  return (
    <div className={estilos.pagina}>
      {volver}
      <header className={estilos.ficha}>
        <span className={estilos.cuando}>
          {lectura.fecha ? textoFecha(lectura.fecha) : textoFecha(partido.fecha)}
          {lectura.competicion &&
            ` · ${lectura.competicion}${lectura.jornada ? ` · Jornada ${lectura.jornada}` : ''}`}
        </span>
        <h1>Revisar el acta</h1>
        <div className={estilos.marcador}>
          <span>{lectura.nombreEquipo}</span>
          <strong>
            {lectura.golesFavor}–{lectura.golesContra}
          </strong>
          <span>{lectura.rival}</span>
        </div>
      </header>

      {(lectura.avisos.length > 0 || yaImportado) && (
        <ul className={estilos.avisosActa}>
          {yaImportado && (
            <li>Este acta ya se registró: al volver a registrarla se sustituye lo importado.</li>
          )}
          {lectura.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      <section className={estilos.seccion} aria-labelledby="titulares">
        <h2 id="titulares">
          <Users aria-hidden size={20} />
          Titulares
        </h2>
        <ul className={estilos.convocados}>{lectura.titulares.map(fila)}</ul>
      </section>
      <section className={estilos.seccion} aria-labelledby="suplentes">
        <h2 id="suplentes">
          <Users aria-hidden size={20} />
          Suplentes
        </h2>
        <ul className={estilos.convocados}>{lectura.suplentes.map(fila)}</ul>
      </section>

      {lectura.cambios.length > 0 && (
        <section className={estilos.seccion} aria-labelledby="cambios">
          <h2 id="cambios">Cambios</h2>
          <ul className={estilos.convocados}>
            {lectura.cambios.map((c) => (
              <li key={`${c.entra.nombre}-${c.sale.nombre}`}>
                <span className={estilos.minuto}>{c.minuto ?? '–'}'</span>
                <span className={estilos.cambio}>
                  <span>
                    <ArrowUpRight aria-label="Entra" size={16} className={estilos.entra} />
                    {nombreDe(c.entra.nombre)}
                  </span>
                  <span>
                    <ArrowDownLeft aria-label="Sale" size={16} className={estilos.sale} />
                    {nombreDe(c.sale.nombre)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(lectura.goles.length > 0 || lectura.golesEnContra.length > 0) && (
        <section className={estilos.seccion} aria-labelledby="goles">
          <h2 id="goles">
            <Goal aria-hidden size={20} />
            Goles
          </h2>
          <ul className={estilos.convocados}>
            {conClave(lectura.goles, 'f').map(({ clave, ...g }) => (
              <li key={clave}>
                <span className={estilos.minuto}>{g.minuto ?? '–'}'</span>
                <span>{g.enPropia ? `En propia puerta (${g.nombre})` : nombreDe(g.nombre)}</span>
              </li>
            ))}
            {conClave(lectura.golesEnContra, 'c').map(({ clave, ...g }) => (
              <li key={clave} className={estilos.secundario}>
                <span className={estilos.minuto}>{g.minuto ?? '–'}'</span>
                <span>
                  {g.enPropia
                    ? `${nombreDe(g.nombre)}, en propia puerta`
                    : `Gol del rival (${g.nombre})`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lectura.tarjetas.length > 0 && (
        <section className={estilos.seccion} aria-labelledby="tarjetas">
          <h2 id="tarjetas">
            <RectangleVertical aria-hidden size={20} />
            Tarjetas
          </h2>
          <ul className={estilos.convocados}>
            {lectura.tarjetas.map((t, i) => (
              <li key={`${t.nombre}-${t.minuto}`} className={estilos.filaActa}>
                <span className={estilos.minuto}>{t.minuto ?? '–'}'</span>
                <label className={estilos.eleccion}>
                  <span>{nombreDe(t.nombre)}</span>
                  <select
                    value={tipos[i] ?? ''}
                    onChange={(e) => setTipos({ ...tipos, [i]: e.target.value as Tarjeta | '' })}
                    aria-invalid={!tipos[i] || undefined}
                  >
                    <option value="">Elige el tipo</option>
                    <option value="amarilla">Amarilla</option>
                    <option value="roja">Roja</option>
                  </select>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      {repetidos.size > 0 && (
        <p className={estilos.error} role="alert">
          Hay un jugador elegido para dos nombres del acta.
        </p>
      )}
      <div className={estilos.acciones}>
        <Boton
          icono={<FileCheck aria-hidden size={18} />}
          cargando={registrar.isPending}
          disabled={repetidos.size > 0 || sinTipo}
          onClick={() => {
            setError(null)
            registrar.mutate()
          }}
        >
          Registrar el acta
        </Boton>
      </div>
    </div>
  )
}
