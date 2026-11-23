import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronLeft, Save } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, datos } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { textoFecha } from '../entrenos/datos'
import { MarcaInvitado } from '../jugadores/BuscadorInvitables'
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
  // Se vuelve a la pestaña Partido de la ficha, donde está la alineación (GH-283)
  const volverA = `${ficha}?pestana=partido`
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
      navegar(volverA)
    },
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido guardar',
      }),
  })

  return (
    <div className={estilos.pagina}>
      <Link to={volverA} className={estilos.volver}>
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
          {/* Dos grupos (GH-293): cada jugador pasa al otro con su botón; nadie en gris */}
          {(
            [
              { titulo: 'Titulares', deTitulares: true },
              { titulo: 'Suplentes', deTitulares: false },
            ] as const
          ).map(({ titulo, deTitulares }) => {
            const grupo = convocados.filter((j) => titulares.has(j.jugadorId) === deTitulares)
            const idTitulo = `grupo-${titulo.toLowerCase()}`
            return (
              <section key={titulo} aria-labelledby={idTitulo} className={estilos.grupoAlineacion}>
                <h2 id={idTitulo} className={estilos.cabeceraLinea}>
                  {titulo}{' '}
                  <span
                    className={estilos.cuentaLinea}
                    data-error={(deTitulares && demasiados) || undefined}
                  >
                    {deTitulares ? `${grupo.length} de ${MAXIMO}` : grupo.length}
                  </span>
                </h2>
                {grupo.length === 0 ? (
                  <p className={estilos.secundario}>
                    {deTitulares ? 'Ningún titular todavía.' : 'Ningún suplente.'}
                  </p>
                ) : (
                  <ul className={estilos.seleccion} aria-label={titulo}>
                    {grupo.map((j) => (
                      <li key={j.jugadorId}>
                        <div className={estilos.filaAlineacion}>
                          <Dorsal dorsal={j.dorsal} />
                          <span className={estilos.texto}>
                            <span className={estilos.nombre}>
                              {nombreCompleto(j)}
                              {j.tipo === 'invitado' && <MarcaInvitado />}
                            </span>
                          </span>
                          <Boton
                            variante="texto"
                            icono={
                              deTitulares ? (
                                <ArrowDown aria-hidden size={18} />
                              ) : (
                                <ArrowUp aria-hidden size={18} />
                              )
                            }
                            aria-label={`Pasar a ${nombreCompleto(j)} a ${deTitulares ? 'suplentes' : 'titulares'}`}
                            onClick={() => alternar(j.jugadorId)}
                          >
                            {deTitulares ? 'Suplente' : 'Titular'}
                          </Boton>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
          {/* La barra fija: el recuento y Guardar; con más de 11 titulares, el aviso */}
          <div className={`${estilos.pieFijo} ${estilos.pieConvocatoria}`}>
            <div className={estilos.resumenConvocatoria} role="status" aria-live="polite">
              <p>
                <strong>{titulares.size}</strong> {titulares.size === 1 ? 'titular' : 'titulares'} ·{' '}
                <strong>{convocados.length - titulares.size}</strong>{' '}
                {convocados.length - titulares.size === 1 ? 'suplente' : 'suplentes'}
              </p>
              {demasiados && (
                <p className={estilos.sinPortero}>No puede haber más de {MAXIMO} titulares.</p>
              )}
            </div>
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
