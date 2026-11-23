import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, Plus, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { api, datos } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { textoFecha } from '../entrenos/datos'
import { BuscadorInvitables, MarcaInvitado } from '../jugadores/BuscadorInvitables'
import {
  CLAVE_JUGADORES,
  type JugadorInvitable,
  nombreCompleto,
  type Posicion,
} from '../jugadores/datos'
import { estadoJugador } from '../jugadores/estado'
import { MarcaLesion } from '../jugadores/Lesiones'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { MarcaSancion } from '../jugadores/Sanciones'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_PARTIDOS, type Partido, usePartido } from './datos'
import { EntrenosPrevios } from './EntrenosPrevios'
import estilos from './Partidos.module.css'

// Elegir los convocados de un partido: se marca la lista y se guarda entera al final. Se puede
// convocar también a jugadores de otras plantillas del club: al guardar se crea su ficha de
// invitado, solo para partidos (GH-188)
// Las líneas, en el orden de un equipo, y al final quien no tiene posición
const LINEAS: { id: Posicion | null; nombre: string; corto: string; uno: string }[] = [
  { id: 'portero', nombre: 'Porteros', corto: 'POR', uno: 'portero' },
  { id: 'defensa', nombre: 'Defensas', corto: 'DEF', uno: 'defensa' },
  { id: 'centrocampista', nombre: 'Centrocampistas', corto: 'MED', uno: 'centrocampista' },
  { id: 'delantero', nombre: 'Delanteros', corto: 'DEL', uno: 'delantero' },
  { id: null, nombre: 'Sin posición', corto: 'sin posición', uno: 'sin posición' },
]

// Por dorsal; sin dorsal, al final y por nombre
const porDorsal = (
  a: { dorsal: number | null; nombre: string },
  b: { dorsal: number | null; nombre: string },
) => (a.dorsal ?? 1000) - (b.dorsal ?? 1000) || a.nombre.localeCompare(b.nombre, 'es')

export function PaginaConvocatoria() {
  const plantilla = usePlantillaActiva()
  const { partidoId = '' } = useParams()
  const partido = usePartido(plantilla.id, partidoId)

  if (partido.isPending) return <Cargando />
  if (partido.isError) {
    return <EstadoVacio titulo="No se encuentra el partido" descripcion={partido.error.message} />
  }
  // Se monta con los datos del partido: la selección empieza con la convocatoria guardada
  return <Seleccion partido={partido.data} />
}

function Seleccion({ partido }: { partido: Partido }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  // Se vuelve a la pestaña Previa de la ficha, donde está la convocatoria (GH-283)
  const ficha = `/plantillas/${plantilla.id}/partidos/${partido.id}?pestana=previa`
  const inicial = partido.jugadores.filter((j) => j.convocado).map((j) => j.jugadorId)
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(inicial))
  const [buscandoFuera, setBuscandoFuera] = useState(false)
  const [guardado, setGuardado] = useState(false)
  // De otras plantillas, todavía sin ficha en esta
  const [externos, setExternos] = useState<JugadorInvitable[]>([])

  const cambiado =
    !guardado &&
    (externos.length > 0 ||
      elegidos.size !== inicial.length ||
      inicial.some((id) => !elegidos.has(id)))
  // Los de baja solo se pueden quitar: si ya no están elegidos, no se vuelven a convocar
  const convocables = partido.jugadores.filter((j) => j.activo || elegidos.has(j.jugadorId))

  function alternar(id: string) {
    const nuevos = new Set(elegidos)
    if (nuevos.has(id)) nuevos.delete(id)
    else nuevos.add(id)
    setElegidos(nuevos)
  }

  // Al salir con cambios sin guardar se pide confirmación, también al cerrar la página
  const bloqueo = useBlocker(cambiado)
  useEffect(() => {
    if (bloqueo.state !== 'blocked') return
    void confirmar({
      titulo: '¿Salir sin guardar la convocatoria?',
      mensaje: 'Los cambios en los convocados se perderán.',
      textoConfirmar: 'Salir sin guardar',
      textoCancelar: 'Seguir convocando',
      peligrosa: true,
    }).then((salir) => (salir ? bloqueo.proceed() : bloqueo.reset()))
  }, [bloqueo, confirmar])
  useEffect(() => {
    if (!cambiado) return
    const alSalir = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [cambiado])

  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PUT('/api/plantillas/{id}/partidos/{pid}/convocados', {
          params: { path: { id: plantilla.id, pid: partido.id } },
          // En el orden de la lista (por dorsal)
          body: {
            jugadores: [
              ...partido.jugadores.filter((j) => elegidos.has(j.jugadorId)).map((j) => j.jugadorId),
              ...externos.map((j) => j.jugadorId),
            ],
          },
        }),
      ),
    onSuccess: async (actualizado) => {
      setGuardado(true)
      await cliente.invalidateQueries({ queryKey: CLAVE_PARTIDOS })
      if (externos.length > 0) await cliente.invalidateQueries({ queryKey: CLAVE_JUGADORES })
      const n = actualizado.jugadores.filter((j) => j.convocado).length
      avisar({
        tipo: 'exito',
        mensaje: `Convocatoria guardada: ${n} ${n === 1 ? 'convocado' : 'convocados'}`,
      })
    },
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido guardar',
      }),
  })

  // Tras guardar ya no hay cambios pendientes: se vuelve a la ficha sin preguntar
  useEffect(() => {
    if (guardado) navegar(ficha)
  }, [guardado, navegar, ficha])

  // El reparto por líneas de los convocados; los de otras plantillas no traen posición
  const total = elegidos.size + externos.length
  const reparto = LINEAS.map((linea) => ({
    linea,
    n:
      partido.jugadores.filter(
        (j) => elegidos.has(j.jugadorId) && (j.posicion ?? null) === linea.id,
      ).length + (linea.id === null ? externos.length : 0),
  })).filter(({ n }) => n > 0)
  const sinPortero = total > 0 && !reparto.some(({ linea }) => linea.id === 'portero')

  // Una fila de la lista para convocar
  const fila = (j: (typeof convocables)[number]) => {
    const elegido = elegidos.has(j.jugadorId)
    return (
      <li key={j.jugadorId} data-convocado={elegido}>
        <label>
          <input type="checkbox" checked={elegido} onChange={() => alternar(j.jugadorId)} />
          <span className={estilos.casilla} aria-hidden="true">
            {elegido && <Check size={20} />}
          </span>
          <Dorsal
            dorsal={j.dorsal}
            estado={estadoJugador({ lesion: j.lesion, sancion: j.sancion })}
          />
          <span className={estilos.texto}>
            <span className={estilos.nombre}>
              {/* El sancionado para este partido, tachado (GH-248); lo dice el texto de debajo */}
              <span className={j.sancion ? estilos.tachado : undefined}>{nombreCompleto(j)}</span>
              {j.tipo === 'invitado' && <MarcaInvitado />}
              {/* De baja y ya convocado: raro, pero hay que verlo */}
              {!j.activo && <span className={estilos.secundario}> · baja</span>}
            </span>
            {/* Una línea por fila (GH-289): solo lesionados y sancionados llevan segunda */}
            {(j.lesion || j.sancion) && (
              <span className={estilos.secundario}>
                {j.lesion && <MarcaLesion lesion={j.lesion} />}
                {j.lesion && j.sancion && ' · '}
                {j.sancion && <MarcaSancion partidos={j.sancion.partidos} />}
              </span>
            )}
          </span>
          {/* Cómo ha entrenado desde el partido anterior, a la derecha (GH-288) */}
          <EntrenosPrevios entrenos={j.entrenosPrevios} />
        </label>
      </li>
    )
  }

  return (
    <div className={estilos.pagina}>
      <Link to={ficha} className={estilos.volver}>
        <ChevronLeft aria-hidden size={20} />
        {partido.local === false ? 'en ' : 'vs '}
        {partido.rival}
      </Link>
      <div>
        <h1>Convocatoria</h1>
        <p className={estilos.cuando}>{textoFecha(partido.fecha)}</p>
      </div>

      <div className={estilos.barraConvocatoria}>
        <Boton
          variante="texto"
          onClick={() =>
            setElegidos(
              new Set([
                // Los lesionados y los sancionados, no: se convocan uno a uno (GH-230, GH-231)
                ...partido.jugadores
                  .filter((j) => j.activo && !j.lesion && !j.sancion)
                  .map((j) => j.jugadorId),
                ...[...elegidos],
              ]),
            )
          }
        >
          Todos los disponibles
        </Boton>
        <Boton variante="texto" onClick={() => setElegidos(new Set())}>
          Ninguno
        </Boton>
      </div>

      {convocables.length === 0 ? (
        <EstadoVacio
          titulo="No hay jugadores activos"
          descripcion="Añádelos desde la pestaña Plantilla para poder convocarlos."
        />
      ) : (
        // Por líneas, como se piensa una convocatoria (GH-290); dentro, por dorsal
        <div className={estilos.lineasConvocatoria}>
          {LINEAS.map(({ id, nombre }) => {
            const deLaLinea = convocables.filter((j) => (j.posicion ?? null) === id).sort(porDorsal)
            if (deLaLinea.length === 0) return null
            const marcados = deLaLinea.filter((j) => elegidos.has(j.jugadorId)).length
            const idTitulo = `linea-${id ?? 'sin-posicion'}`
            return (
              <section key={idTitulo} aria-labelledby={idTitulo}>
                <h2 id={idTitulo} className={estilos.cabeceraLinea}>
                  {nombre}{' '}
                  <span className={estilos.cuentaLinea}>
                    {marcados} de {deLaLinea.length}
                  </span>
                </h2>
                <ul className={estilos.seleccion} aria-label={nombre}>
                  {deLaLinea.map((j) => fila(j))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {/* Plegado tras un botón (GH-292): las sugerencias no parecen de la plantilla. Los ya añadidos
          se ven siempre */}
      <section className={estilos.otrasPlantillas} aria-label="De otras plantillas">
        {(externos.length > 0 || buscandoFuera) && <h2>De otras plantillas</h2>}
        {externos.length > 0 && (
          <ul className={estilos.seleccion} aria-label="Convocados de otras plantillas">
            {externos.map((j) => (
              <li key={j.jugadorId} data-convocado="true">
                <div className={estilos.externo}>
                  <span className={estilos.texto}>
                    <span className={estilos.nombre}>
                      {nombreCompleto(j)}
                      <MarcaInvitado />
                    </span>
                    <span className={estilos.secundario}>{j.plantilla}</span>
                  </span>
                  <Boton
                    variante="texto"
                    icono={<X aria-hidden size={18} />}
                    aria-label={`Quitar a ${nombreCompleto(j)}`}
                    onClick={() => setExternos(externos.filter((e) => e.jugadorId !== j.jugadorId))}
                  >
                    Quitar
                  </Boton>
                </div>
              </li>
            ))}
          </ul>
        )}
        {buscandoFuera ? (
          <BuscadorInvitables
            plantillaId={plantilla.id}
            excluir={new Set(externos.map((j) => j.jugadorId))}
            alElegir={(j) => setExternos([...externos, j])}
            enfocar
            accion="Convocar"
          />
        ) : (
          <Boton
            variante="secundario"
            className={estilos.botonOtraPlantilla}
            icono={<Plus aria-hidden size={18} />}
            onClick={() => setBuscandoFuera(true)}
          >
            Convocar a alguien de otra plantilla
          </Boton>
        )}
      </section>

      {/* La barra fija (GH-291): cuántos van y su reparto por líneas, a la vista al bajar. Para
          salir sin guardar, volver atrás (pide confirmación si hay cambios) */}
      <div className={`${estilos.pieFijo} ${estilos.pieConvocatoria}`}>
        <div className={estilos.resumenConvocatoria} role="status" aria-live="polite">
          {total === 0 ? (
            <p>Marca a los que van</p>
          ) : (
            <>
              <p>
                <strong>{total}</strong> {total === 1 ? 'convocado' : 'convocados'}
                {sinPortero && <span className={estilos.sinPortero}> · Sin portero</span>}
              </p>
              <p className={estilos.repartoLineas}>
                {/* Cada línea entera; entre ellas, se puede bajar de renglón */}
                <span aria-hidden="true">
                  {reparto.map(({ linea, n }, i) => (
                    <span key={linea.corto}>
                      {i > 0 && ' · '}
                      <span className={estilos.sinCortar}>
                        {n} {linea.corto}
                      </span>
                    </span>
                  ))}
                </span>
                <span className="solo-lectores">
                  {reparto
                    .map(({ linea, n }) =>
                      linea.id === null
                        ? `${n} sin posición`
                        : `${n} ${linea.uno}${n === 1 ? '' : 's'}`,
                    )
                    .join(', ')}
                </span>
              </p>
            </>
          )}
        </div>
        <Boton
          // Sin nadie, nada que guardar; salvo para vaciar una convocatoria ya guardada
          disabled={total === 0 && inicial.length === 0}
          // En la barra, corto para dejar sitio al resumen; el nombre completo, para el lector
          aria-label="Guardar convocatoria"
          cargando={guardar.isPending}
          icono={<Save aria-hidden size={18} />}
          onClick={async () => {
            // Un sancionado para este partido se puede convocar, pero se avisa antes (GH-231)
            const sancionados = partido.jugadores.filter(
              (j) => j.sancion && elegidos.has(j.jugadorId),
            )
            if (sancionados.length > 0) {
              const nombres = sancionados.map((j) => nombreCompleto(j)).join(', ')
              const varios = sancionados.length > 1
              const confirmado = await confirmar({
                titulo: varios
                  ? `${nombres} están sancionados para este partido`
                  : `${nombres} está sancionado para este partido`,
                mensaje: 'Según las tarjetas de los partidos anteriores de esta competición.',
                textoConfirmar: varios ? 'Convocarlos igualmente' : 'Convocarlo igualmente',
              })
              if (!confirmado) return
            }
            guardar.mutate()
          }}
        >
          Guardar
        </Boton>
      </div>
    </div>
  )
}
