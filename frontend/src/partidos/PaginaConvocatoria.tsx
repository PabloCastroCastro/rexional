import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, Save, X } from 'lucide-react'
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
  POSICIONES,
  textoInvitado,
} from '../jugadores/datos'
import { MarcaLesion } from '../jugadores/Lesiones'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_PARTIDOS, type Partido, usePartido } from './datos'
import estilos from './Partidos.module.css'

// Elegir los convocados de un partido: se marca la lista y se guarda entera al final. Se puede
// convocar también a jugadores de otras plantillas del club: al guardar se crea su ficha de
// invitado, solo para partidos (GH-188)
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
  const ficha = `/plantillas/${plantilla.id}/partidos/${partido.id}`
  const inicial = partido.jugadores.filter((j) => j.convocado).map((j) => j.jugadorId)
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(inicial))
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
        <p role="status" aria-live="polite">
          <strong>{elegidos.size + externos.length}</strong>{' '}
          {elegidos.size + externos.length === 1 ? 'convocado' : 'convocados'} de{' '}
          {partido.jugadores.filter((j) => j.activo).length + externos.length}
        </p>
        <Boton
          variante="texto"
          onClick={() =>
            setElegidos(
              new Set([
                // Los lesionados, no: se convocan uno a uno (GH-230)
                ...partido.jugadores.filter((j) => j.activo && !j.lesion).map((j) => j.jugadorId),
                ...[...elegidos],
              ]),
            )
          }
        >
          Todos
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
        <ul className={estilos.seleccion} aria-label="Jugadores">
          {convocables.map((j) => {
            const elegido = elegidos.has(j.jugadorId)
            return (
              <li key={j.jugadorId} data-convocado={elegido}>
                <label>
                  <input type="checkbox" checked={elegido} onChange={() => alternar(j.jugadorId)} />
                  <span className={estilos.casilla} aria-hidden="true">
                    {elegido && <Check size={20} />}
                  </span>
                  <Dorsal dorsal={j.dorsal} />
                  <span className={estilos.texto}>
                    <span className={estilos.nombre}>
                      {nombreCompleto(j)}
                      {j.tipo === 'invitado' && <MarcaInvitado />}
                    </span>
                    <span className={estilos.secundario}>
                      {[
                        j.tipo === 'invitado' ? textoInvitado(j) : null,
                        j.posicion ? POSICIONES[j.posicion] : null,
                        !j.activo && 'baja',
                        !elegido && 'No convocado',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {j.lesion && (
                        <>
                          {' · '}
                          <MarcaLesion lesion={j.lesion} />
                        </>
                      )}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <section className={estilos.otrasPlantillas} aria-labelledby="otras-plantillas">
        <h2 id="otras-plantillas">De otras plantillas</h2>
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
        <BuscadorInvitables
          plantillaId={plantilla.id}
          excluir={new Set(externos.map((j) => j.jugadorId))}
          alElegir={(j) => setExternos([...externos, j])}
        />
      </section>

      <div className={estilos.pieFijo}>
        <Boton variante="secundario" onClick={() => navegar(ficha)}>
          Cancelar
        </Boton>
        <Boton
          cargando={guardar.isPending}
          icono={<Save aria-hidden size={18} />}
          onClick={() => guardar.mutate()}
        >
          Guardar convocatoria
        </Boton>
      </div>
    </div>
  )
}
