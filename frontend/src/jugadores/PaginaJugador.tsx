import { ChevronLeft, Pencil, RotateCcw, UserMinus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { useResumenAsistencia } from '../entrenos/datos'
import { Porcentaje } from '../entrenos/Porcentaje'
import { euros, useMultas } from '../multas/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { useBajaYReactivacion } from './acciones'
import {
  type JugadorPlantilla,
  nombreCompleto,
  POSICIONES,
  puedeGestionarJugadores,
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
            {jugador.posicion ? POSICIONES[jugador.posicion] : 'Sin posición'}
            {!jugador.activo && ' · De baja'}
          </span>
        </div>
      </div>

      {gestiona && (
        <div className={estilos.acciones}>
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
          <p className={estilos.asistencia}>
            <Porcentaje valor={asistencia.porcentaje} />
            <span className={estilos.secundario}>
              {asistencia.porcentaje === null
                ? 'Todavía sin entrenos registrados'
                : [
                    `${asistencia.asiste} ${asistencia.asiste === 1 ? 'asistencia' : 'asistencias'}`,
                    `${asistencia.justificada} ${asistencia.justificada === 1 ? 'justificada' : 'justificadas'}`,
                    `${asistencia.falta} ${asistencia.falta === 1 ? 'falta' : 'faltas'}`,
                  ].join(' · ')}
            </span>
          </p>
        </section>
      )}

      {plantilla.multasActivas && multasPendientes.data && (
        <section className={estilos.seccion} aria-labelledby="multas">
          <h2 id="multas">Multas en esta plantilla</h2>
          <p className={estilos.asistencia}>
            <span className={estilos.secundario}>
              {multasPendientes.data.length === 0
                ? 'Nada pendiente'
                : `${euros(deuda)} pendientes · ${multasPendientes.data.length} ${
                    multasPendientes.data.length === 1 ? 'multa' : 'multas'
                  }`}
            </span>
            <Link to={`/plantillas/${plantilla.id}/multas/lista?jugador=${jugadorId}&estado=todas`}>
              Ver sus multas
            </Link>
          </p>
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
