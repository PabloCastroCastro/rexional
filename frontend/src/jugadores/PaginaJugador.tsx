import { ChevronLeft, ChevronRight, Pencil, RotateCcw, UserMinus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { type Cifra, Cifras } from '../componentes/Cifras'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { useResumenAsistencia } from '../entrenos/datos'
import { nivelAsistencia } from '../entrenos/Porcentaje'
import { euros, useMultas } from '../multas/datos'
import { useEstadisticas, useTrayectoriaEstadisticas } from '../partidos/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { useBajaYReactivacion } from './acciones'
import { MarcaInvitado } from './BuscadorInvitables'
import {
  type JugadorPlantilla,
  nombreCompleto,
  POSICIONES,
  puedeGestionarJugadores,
  textoInvitado,
  useTrayectoria,
} from './datos'
import { FormularioJugador, type ModoFormulario } from './FormularioJugador'
import estilos from './Jugadores.module.css'
import { Dorsal } from './PaginaPlantilla'

// Un jugador de la plantilla: su ficha en ella, con editar y dar de baja o reactivar, y su
// trayectoria en el club por temporadas
export function PaginaJugador() {
  const plantilla = usePlantillaActiva()
  const { jugadorId = '' } = useParams()
  const navegar = useNavigate()
  const trayectoria = useTrayectoria(plantilla.clubId, jugadorId)
  const estadisticas = useEstadisticas(plantilla.id)
  const numeros = useTrayectoriaEstadisticas(plantilla.clubId, jugadorId)
  const resumen = useResumenAsistencia(plantilla.id)
  const asistencia = resumen.data?.find((r) => r.jugadorId === jugadorId)
  const multasPendientes = useMultas(
    plantilla.id,
    { jugador: jugadorId, estado: 'pendientes' },
    plantilla.multasActivas,
  )
  const deuda = (multasPendientes.data ?? []).reduce((total, m) => total + m.importeCentimos, 0)
  const [formulario, setFormulario] = useState<ModoFormulario | null>(null)
  const lista = `/plantillas/${plantilla.id}/jugadores`
  const { darDeBaja, reactivar, pendiente } = useBajaYReactivacion({
    alDarDeBaja: () => navegar(lista),
    alDorsalOcupado: (j, mensaje) =>
      setFormulario({ tipo: 'editar', jugador: j, reactivar: true, errorDorsal: mensaje }),
  })

  const fichaActual = trayectoria.data?.fichas.find((f) => f.plantillaId === plantilla.id)
  const volver = (
    <Link
      to={fichaActual?.activo === false ? `${lista}?ver=bajas` : lista}
      className={estilos.volver}
    >
      <ChevronLeft aria-hidden size={20} />
      Plantilla
    </Link>
  )

  if (trayectoria.isPending) return <Cargando />
  const ficha = fichaActual
  if (!trayectoria.data || !ficha) {
    return (
      <div className={estilos.pagina}>
        {volver}
        <EstadoVacio
          titulo="Este jugador no está en la plantilla"
          descripcion={trayectoria.error?.message}
        />
      </div>
    )
  }

  const jugador: JugadorPlantilla = {
    jugadorId: trayectoria.data.id,
    nombre: trayectoria.data.nombre,
    apellidos: trayectoria.data.apellidos,
    dorsal: ficha.dorsal,
    posicion: ficha.posicion,
    activo: ficha.activo,
    tipo: ficha.tipo,
    enDinamica: ficha.enDinamica,
    procedencia: ficha.procedencia,
  }
  const gestiona = puedeGestionarJugadores(plantilla)

  return (
    <div className={estilos.pagina}>
      {volver}

      <div className={estilos.ficha}>
        <Dorsal dorsal={jugador.dorsal} />
        <div className={estilos.texto}>
          <h1>{nombreCompleto(jugador)}</h1>
          <span className={estilos.secundario}>
            {[
              jugador.posicion ? POSICIONES[jugador.posicion] : 'Sin posición',
              jugador.tipo === 'invitado' && textoInvitado(jugador),
              jugador.tipo === 'invitado' &&
                (jugador.enDinamica ? 'En la dinámica' : 'Solo partidos'),
              !jugador.activo && 'De baja',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      </div>

      {gestiona && (
        <div className={estilos.accionesFicha}>
          <Boton
            variante="secundario"
            icono={<Pencil aria-hidden size={18} />}
            onClick={() => setFormulario({ tipo: 'editar', jugador })}
          >
            Editar
          </Boton>
          {jugador.activo ? (
            <Boton
              variante="peligro"
              icono={<UserMinus aria-hidden size={18} />}
              cargando={pendiente}
              onClick={() => darDeBaja(jugador)}
            >
              Dar de baja
            </Boton>
          ) : (
            <Boton
              icono={<RotateCcw aria-hidden size={18} />}
              cargando={pendiente}
              onClick={() => reactivar(jugador)}
            >
              Reactivar
            </Boton>
          )}
        </div>
      )}

      {asistencia && (
        <section className={estilos.seccion} aria-labelledby="asistencia">
          <h2 id="asistencia">Asistencia en esta plantilla</h2>
          <Cifras
            cifras={[
              {
                texto: 'Asistencia',
                vacia: asistencia.porcentaje === null,
                valor:
                  asistencia.porcentaje === null ? (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className="solo-lectores">Sin entrenos registrados</span>
                    </>
                  ) : (
                    <span
                      className={estilos.porcentajeCifra}
                      data-nivel={nivelAsistencia(asistencia.porcentaje)}
                    >
                      {asistencia.porcentaje} %
                    </span>
                  ),
              },
              cifra('Asiste', asistencia.asiste),
              cifra('Justificadas', asistencia.justificada),
              cifra('Faltas', asistencia.falta),
            ]}
          />
        </section>
      )}

      {plantilla.multasActivas && multasPendientes.data && (
        <section className={estilos.seccion} aria-labelledby="multas">
          <h2 id="multas">Multas en esta plantilla</h2>
          <p className={estilos.lineaMultas}>
            {multasPendientes.data.length === 0 ? (
              <span className={estilos.secundario}>Nada pendiente</span>
            ) : (
              <span>
                <strong className={estilos.importe}>{euros(deuda)}</strong>{' '}
                <span className={estilos.secundario}>
                  pendientes · {multasPendientes.data.length}{' '}
                  {multasPendientes.data.length === 1 ? 'multa' : 'multas'}
                </span>
              </span>
            )}
            {/* El rol jugador tiene las suyas en el índice de Multas (GH-52) */}
            <Link
              className={estilos.enlaceMultas}
              to={
                gestiona
                  ? `/plantillas/${plantilla.id}/multas/lista?jugador=${jugadorId}&estado=todas`
                  : `/plantillas/${plantilla.id}/multas?estado=todas`
              }
            >
              {gestiona ? 'Ver sus multas' : 'Ver tus multas'}
              <ChevronRight aria-hidden size={18} />
            </Link>
          </p>
        </section>
      )}

      {estadisticas.data && (
        <section className={estilos.seccion} aria-labelledby="partidos">
          <h2 id="partidos">Partidos en esta plantilla</h2>
          {(() => {
            // Sin fila (no ha jugado, o es un invitado sin minutos), todo a cero
            const suyas = estadisticas.data.jugadores.find((j) => j.jugadorId === jugadorId)
            // Arriba lo jugado; abajo lo que ha hecho en el campo
            return (
              <div className={estilos.dosFilas}>
                <Cifras
                  columnas={3}
                  cifras={[
                    cifra('Partidos', suyas?.partidos ?? 0),
                    cifra('De titular', suyas?.titularidades ?? 0),
                    cifra('Minutos', suyas?.minutos ?? 0),
                  ]}
                />
                <Cifras
                  cifras={[
                    cifra('Goles', suyas?.goles ?? 0),
                    cifra('Asistencias', suyas?.asistencias ?? 0),
                    cifra('Amarillas', suyas?.amarillas ?? 0),
                    cifra('Rojas', suyas?.rojas ?? 0),
                  ]}
                />
              </div>
            )
          })()}
        </section>
      )}

      <section className={estilos.seccion} aria-labelledby="trayectoria">
        <h2 id="trayectoria">Temporadas en el club</h2>
        <ul className={estilos.lista}>
          {trayectoria.data.fichas.map((f) => (
            <li key={f.plantillaId}>
              <div className={estilos.fila}>
                <span className={estilos.temporada}>{f.temporada}</span>
                <span className={estilos.texto}>
                  <strong>
                    {f.plantilla}
                    {f.plantillaId === plantilla.id && ' (esta plantilla)'}
                    {f.tipo === 'invitado' && <MarcaInvitado />}
                  </strong>
                  <span className={estilos.secundario}>
                    {[
                      f.dorsal === null ? 'Sin dorsal' : `Dorsal ${f.dorsal}`,
                      f.posicion ? POSICIONES[f.posicion] : null,
                      f.activo ? null : 'de baja',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {(() => {
                    const t = numeros.data?.temporadas.find((x) => x.plantillaId === f.plantillaId)
                    return t && t.partidos + t.goles > 0 ? <ResumenTemporada {...t} /> : null
                  })()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <FormularioJugador modo={formulario} alCerrar={() => setFormulario(null)} />
    </div>
  )
}

// Una casilla con un número; a cero, en el color suave
const cifra = (texto: string, valor: number): Cifra => ({ texto, valor, vacia: valor === 0 })

// Las cifras de una temporada, abreviadas, y en palabras para el lector de pantalla
function ResumenTemporada(t: { partidos: number; goles: number; asistencias: number }) {
  return (
    <span className={estilos.resumenTemporada}>
      <span aria-hidden="true">
        {t.partidos} PJ · {t.goles} G · {t.asistencias} A
      </span>
      <span className="solo-lectores">
        {[
          `${t.partidos} ${t.partidos === 1 ? 'partido' : 'partidos'}`,
          `${t.goles} ${t.goles === 1 ? 'gol' : 'goles'}`,
          `${t.asistencias} ${t.asistencias === 1 ? 'asistencia' : 'asistencias'}`,
        ].join(', ')}
      </span>
    </span>
  )
}
