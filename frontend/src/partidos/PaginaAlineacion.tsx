import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, Save } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, datos } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { textoFecha } from '../entrenos/datos'
import { nombreCompleto } from '../jugadores/datos'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_PARTIDOS, type Partido, usePartido } from './datos'
import estilos from './Partidos.module.css'

// Titulares y suplentes de un partido, entre los convocados: los marcados son titulares (como
// mucho 11) y el resto, suplentes. Con los cambios se calculan los minutos de cada uno.
export function PaginaAlineacion() {
  const plantilla = usePlantillaActiva()
  const { partidoId = '' } = useParams()
  const partido = usePartido(plantilla.id, partidoId)

  if (partido.isPending) return <Cargando />
  if (partido.isError) {
    return <EstadoVacio titulo="No se encuentra el partido" descripcion={partido.error.message} />
  }
  return <Alineacion partido={partido.data} />
}

const MAXIMO = 11

function Alineacion({ partido }: { partido: Partido }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const { avisar } = useAvisos()
  const ficha = `/plantillas/${plantilla.id}/partidos/${partido.id}`
  const convocados = partido.jugadores.filter((j) => j.convocado)
  const [titulares, setTitulares] = useState<Set<string>>(
    () => new Set(convocados.filter((j) => j.titular).map((j) => j.jugadorId)),
  )
  const demasiados = titulares.size > MAXIMO

  function alternar(id: string) {
    const nuevos = new Set(titulares)
    if (nuevos.has(id)) nuevos.delete(id)
    else nuevos.add(id)
    setTitulares(nuevos)
  }

  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PUT('/api/plantillas/{id}/partidos/{pid}/participaciones', {
          params: { path: { id: plantilla.id, pid: partido.id } },
          body: {
            titulares: convocados.filter((j) => titulares.has(j.jugadorId)).map((j) => j.jugadorId),
            suplentes: convocados
              .filter((j) => !titulares.has(j.jugadorId))
              .map((j) => j.jugadorId),
          },
        }),
      ),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: CLAVE_PARTIDOS })
      const suplentes = convocados.length - titulares.size
      avisar({
        tipo: 'exito',
        mensaje: `Guardado: ${titulares.size} ${titulares.size === 1 ? 'titular' : 'titulares'} y ${suplentes} ${suplentes === 1 ? 'suplente' : 'suplentes'}`,
      })
      navegar(ficha)
    },
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido guardar',
      }),
  })

  return (
    <div className={estilos.pagina}>
      <Link to={ficha} className={estilos.volver}>
        <ChevronLeft aria-hidden size={20} />
        {partido.local === false ? 'en ' : 'vs '}
        {partido.rival}
      </Link>
      <div>
        <h1>Titulares y suplentes</h1>
        <p className={estilos.cuando}>{textoFecha(partido.fecha)}</p>
      </div>

      {convocados.length === 0 ? (
        <EstadoVacio
          titulo="No hay convocados"
          descripcion="Haz primero la convocatoria: titulares y suplentes salen de ella."
          accion={<Link to={`${ficha}/convocatoria`}>Convocar</Link>}
        />
      ) : (
        <>
          <div className={estilos.barraConvocatoria}>
            <p role="status" aria-live="polite" data-error={demasiados || undefined}>
              <strong>{titulares.size}</strong> de {MAXIMO} titulares ·{' '}
              {convocados.length - titulares.size} suplentes
            </p>
          </div>
          <ul className={estilos.seleccion} aria-label="Convocados">
            {convocados.map((j) => {
              const titular = titulares.has(j.jugadorId)
              return (
                <li key={j.jugadorId} data-convocado={titular}>
                  <label>
                    <input
                      type="checkbox"
                      checked={titular}
                      onChange={() => alternar(j.jugadorId)}
                    />
                    <span className={estilos.casilla} aria-hidden="true">
                      {titular && <Check size={20} />}
                    </span>
                    <Dorsal dorsal={j.dorsal} />
                    <span className={estilos.texto}>
                      <span className={estilos.nombre}>{nombreCompleto(j)}</span>
                      <span className={estilos.secundario}>{titular ? 'Titular' : 'Suplente'}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {demasiados && (
            <p className={estilos.error} role="alert">
              No puede haber más de {MAXIMO} titulares.
            </p>
          )}
          <div className={estilos.pieFijo}>
            <Boton variante="secundario" onClick={() => navegar(ficha)}>
              Cancelar
            </Boton>
            <Boton
              cargando={guardar.isPending}
              disabled={demasiados}
              icono={<Save aria-hidden size={18} />}
              onClick={() => guardar.mutate()}
            >
              Guardar
            </Boton>
          </div>
        </>
      )}
    </div>
  )
}
