import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, MessageCircle, Pencil, Shirt, Trash2, UserCheck, Users } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api, enviar } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { hoy } from '../entrenos/datos'
import { nombresCortos, puedeGestionarJugadores } from '../jugadores/datos'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { SeccionActa } from './Acta'
import { CLAVE_PARTIDOS, type Partido, usePartido } from './datos'
import { FilaVacia } from './FilaVacia'
import { FormularioPartido } from './FormularioPartido'
import { SeccionPartido } from './Jugado'
import { Mensaje } from './Mensaje'
import { SeccionNotas } from './Notas'
import estilos from './Partidos.module.css'
import { SeccionPlanificacion } from './Planificacion'
import { TarjetaPartido } from './TarjetaPartido'
import { SeccionVideos } from './Videos'

type Pestana = 'previa' | 'partido'

const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: 'previa', texto: 'Previa' },
  { id: 'partido', texto: 'Partido' },
]

// Ficha de un partido: la cabecera y, debajo, dos pestañas (GH-283). Previa: convocatoria, mensaje
// y planificación. Partido: resultado y sucesos, alineación, acta, vídeos, notas y borrar. Abre en
// Previa hasta el día del partido y en Partido desde ese día; la elegida va en la dirección
export function PaginaPartido() {
  const plantilla = usePlantillaActiva()
  const { partidoId = '' } = useParams()
  const partido = usePartido(plantilla.id, partidoId)
  const [editando, setEditando] = useState(false)
  const [parametros, setParametros] = useSearchParams()
  const lista = `/plantillas/${plantilla.id}/partidos`
  const volverA = partido.data && partido.data.fecha < hoy() ? `${lista}?ver=pasados` : lista

  const volver = (
    <Link to={volverA} className={estilos.volver}>
      <ChevronLeft aria-hidden size={20} />
      Partidos
    </Link>
  )

  if (partido.isPending) return <Cargando />
  if (partido.isError) {
    return (
      <div className={estilos.pagina}>
        {volver}
        <EstadoVacio titulo="No se encuentra el partido" descripcion={partido.error.message} />
      </div>
    )
  }

  const p = partido.data
  const gestiona = puedeGestionarJugadores(plantilla)
  const convocados = p.jugadores.filter((j) => j.convocado)
  const noConvocados = p.jugadores.filter((j) => !j.convocado)
  const elegida = parametros.get('pestana')
  const pestana: Pestana =
    elegida === 'previa' || elegida === 'partido'
      ? elegida
      : p.fecha <= hoy()
        ? 'partido'
        : 'previa'
  const elegir = (id: Pestana) => setParametros({ pestana: id }, { replace: true })
  // Lo que falta, como punto ámbar en la pestaña que no está abierta: la convocatoria antes del
  // partido y el resultado desde su día
  const falta: Record<Pestana, string | null> = {
    previa:
      convocados.length === 0 && p.estado !== 'jugado' && p.fecha >= hoy()
        ? 'falta la convocatoria'
        : null,
    partido: p.estado === 'programado' && p.fecha <= hoy() ? 'falta el resultado' : null,
  }
  // Flechas, Inicio y Fin mueven entre pestañas, y el foco va con ellas
  const teclas = (e: KeyboardEvent) => {
    const indice = PESTANAS.findIndex((x) => x.id === pestana)
    const destino =
      e.key === 'ArrowRight'
        ? (indice + 1) % PESTANAS.length
        : e.key === 'ArrowLeft'
          ? (indice - 1 + PESTANAS.length) % PESTANAS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? PESTANAS.length - 1
              : null
    if (destino === null) return
    e.preventDefault()
    const id = PESTANAS[destino]?.id ?? 'previa'
    elegir(id)
    document.getElementById(`pestana-${id}`)?.focus()
  }

  return (
    <div className={estilos.pagina}>
      {volver}

      <TarjetaPartido partido={p} alEditar={gestiona ? () => setEditando(true) : undefined} />

      <div role="tablist" aria-label="Ficha del partido" className={estilos.pestanas}>
        {PESTANAS.map(({ id, texto }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`pestana-${id}`}
            aria-selected={pestana === id}
            aria-controls={`panel-${id}`}
            tabIndex={pestana === id ? 0 : -1}
            onClick={() => elegir(id)}
            onKeyDown={teclas}
          >
            {texto}
            {pestana !== id && falta[id] && (
              <>
                <span className={estilos.puntoAviso} aria-hidden="true" />
                <span className="solo-lectores">, {falta[id]}</span>
              </>
            )}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${pestana}`}
        aria-labelledby={`pestana-${pestana}`}
        className={estilos.panelPestana}
      >
        {pestana === 'partido' ? (
          <>
            <SeccionPartido partido={p} />
            <SeccionAlineacion convocados={convocados} gestiona={gestiona} />
            <SeccionActa partido={p} />
            <SeccionVideos partido={p} />
            <SeccionNotas partido={p} />
            {/* Borrar, al final y sin relleno, como «Dar de baja» en la ficha del jugador (GH-229) */}
            {gestiona && (
              <div className={estilos.accionFinal}>
                <BorrarPartido partido={p} alBorrar={volverA} />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Convocados en dos columnas, con dorsal y nombre corto (GH-284): la lista completa, con
                las altas y bajas, está en la pantalla de la convocatoria */}
            <section className={estilos.seccion} aria-labelledby="convocatoria">
              <div className={estilos.cabeceraSeccion}>
                <h2 id="convocatoria">
                  <Users aria-hidden size={20} />
                  Convocatoria
                  {convocados.length > 0 && (
                    <span className={estilos.contador}>{convocados.length}</span>
                  )}
                </h2>
                {gestiona && convocados.length > 0 && (
                  <Link
                    to="convocatoria"
                    className={estilos.enlaceEditar}
                    aria-label="Editar la convocatoria"
                  >
                    <Pencil aria-hidden size={16} />
                    Editar
                  </Link>
                )}
              </div>
              {convocados.length === 0 ? (
                <>
                  <p className={estilos.pendiente}>Todavía sin convocatoria</p>
                  {gestiona && (
                    <Link to="convocatoria" className={estilos.enlaceBoton}>
                      <UserCheck aria-hidden size={18} />
                      Hacer la convocatoria
                    </Link>
                  )}
                </>
              ) : (
                <ListaCorta jugadores={convocados} titulo="Convocados" />
              )}
              {convocados.length > 0 && noConvocados.length > 0 && (
                <details className={estilos.noConvocados}>
                  <summary>
                    {noConvocados.length}{' '}
                    {noConvocados.length === 1 ? 'no convocado' : 'no convocados'}
                  </summary>
                  <ListaCorta jugadores={noConvocados} titulo="No convocados" />
                </details>
              )}
            </section>

            <section className={estilos.seccion} aria-labelledby="mensaje">
              <h2 id="mensaje">
                <MessageCircle aria-hidden size={20} />
                Mensaje para WhatsApp
              </h2>
              <Mensaje plantillaId={plantilla.id} partidoId={p.id} conAcciones={gestiona} />
            </section>

            {/* La planificación no la ve el rol jugador: se dice que es del cuerpo técnico */}
            {gestiona && (
              <div className={estilos.soloCuerpoTecnico}>
                <p className={estilos.avisoCuerpoTecnico}>Solo para el cuerpo técnico</p>
                <SeccionPlanificacion partido={p} />
              </div>
            )}
          </>
        )}
      </div>

      <FormularioPartido abierta={editando} partido={p} alCerrar={() => setEditando(false)} />
    </div>
  )
}

// Jugadores en dos columnas: dorsal y nombre y primer apellido (como al pasar lista, GH-257)
function ListaCorta({ jugadores, titulo }: { jugadores: Partido['jugadores']; titulo: string }) {
  const nombres = nombresCortos(jugadores)
  return (
    <ul className={estilos.dosColumnas} aria-label={titulo}>
      {jugadores.map((j) => (
        <li key={j.jugadorId}>
          <Dorsal dorsal={j.dorsal} />
          <span className={estilos.nombreCorto}>
            {nombres.get(j.jugadorId)}
            {!j.activo && <span className={estilos.secundario}> · baja</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

// La alineación, aparte de la línea del partido (GH-286): en dos columnas, titulares y suplentes,
// con los minutos de cada uno y su propio «Editar». Sin titulares indicados, una fila para indicarlos
function SeccionAlineacion({
  convocados,
  gestiona,
}: {
  convocados: Partido['jugadores']
  gestiona: boolean
}) {
  const nombres = nombresCortos(convocados)
  if (!convocados.some((j) => j.titular !== null)) {
    if (!gestiona || convocados.length === 0) return null
    return (
      <FilaVacia
        id="alineacion"
        icono={<Shirt size={20} />}
        titulo="Alineación"
        frase="Titulares, suplentes y minutos"
        accion={
          <Link to="alineacion" className={estilos.enlaceEditar} aria-label="Indicar titulares">
            Indicar
          </Link>
        }
      />
    )
  }
  const columna = (titulo: string, jugadores: Partido['jugadores']) => (
    <div className={estilos.columnaAlineacion}>
      <h3 className={estilos.subtitulo}>{titulo}</h3>
      <ul className={estilos.listaAlineacion} aria-label={titulo}>
        {jugadores.map((j) => (
          <li key={j.jugadorId} className={estilos.jugadorAlineacion}>
            <Dorsal dorsal={j.dorsal} />
            {/* Los minutos debajo, para que el nombre tenga todo el ancho y no se parta */}
            <span className={estilos.nombreAlineacion}>
              <span>{nombres.get(j.jugadorId)}</span>
              {j.minutos !== null && <span className={estilos.minutosJugador}>{j.minutos}'</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <section className={estilos.seccion} aria-labelledby="alineacion">
      <div className={estilos.cabeceraSeccion}>
        <h2 id="alineacion">
          <Shirt aria-hidden size={20} />
          Alineación
        </h2>
        {gestiona && (
          <Link to="alineacion" className={estilos.enlaceEditar} aria-label="Editar la alineación">
            <Pencil aria-hidden size={16} />
            Editar
          </Link>
        )}
      </div>
      <div className={estilos.alineacion}>
        {columna(
          'Titulares',
          convocados.filter((j) => j.titular === true),
        )}
        {columna(
          'Suplentes',
          convocados.filter((j) => j.titular === false),
        )}
      </div>
    </section>
  )
}

function BorrarPartido({ partido, alBorrar }: { partido: Partido; alBorrar: string }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const conConvocatoria = partido.jugadores.some((j) => j.convocado)

  const borrar = useMutation({
    mutationFn: () =>
      enviar(
        api.DELETE('/api/plantillas/{id}/partidos/{pid}', {
          params: { path: { id: plantilla.id, pid: partido.id } },
        }),
      ),
    onSuccess: async () => {
      navegar(alBorrar, { replace: true })
      await cliente.invalidateQueries({ queryKey: CLAVE_PARTIDOS })
      avisar({ tipo: 'exito', mensaje: `Partido contra ${partido.rival} borrado` })
    },
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido borrar',
      }),
  })

  return (
    <Boton
      variante="texto"
      className={estilos.textoPeligro}
      icono={<Trash2 aria-hidden size={18} />}
      cargando={borrar.isPending}
      onClick={async () => {
        const confirmado = await confirmar({
          titulo: `¿Borrar el partido contra ${partido.rival}?`,
          mensaje: conConvocatoria
            ? 'Ya tiene convocatoria: se borrará también. No se puede deshacer.'
            : 'No se puede deshacer.',
          textoConfirmar: 'Borrar partido',
          peligrosa: true,
        })
        if (confirmado) borrar.mutate()
      }}
    >
      Borrar partido
    </Boton>
  )
}
