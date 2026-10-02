import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { api, enviar } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { HojaInferior } from '../componentes/HojaInferior'
import { agruparPlantillas, CLAVE_PLANTILLAS, type Club, type Plantilla } from '../plantillas/datos'
import { NuevaPlantilla } from '../plantillas/NuevaPlantilla'
import estilos from './Configuracion.module.css'
import { DatosPlantilla } from './DatosPlantilla'

// Todas las plantillas del club, por temporada: crear, editar y borrar (solo administradores del club)
export function PlantillasClub({
  club,
  plantillas,
  actualId,
}: {
  club: Club
  plantillas: Plantilla[]
  actualId: string
}) {
  const navegar = useNavigate()
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<Plantilla | null>(null)
  const [borrando, setBorrando] = useState<Plantilla | null>(null)
  const delClub = plantillas.filter((p) => p.clubId === club.id)
  const temporadas = agruparPlantillas(delClub)[0]?.temporadas ?? []

  return (
    <>
      {temporadas.map(({ temporada, plantillas: deLaTemporada }) => (
        <div key={temporada}>
          <h3 className={estilos.temporada}>Temporada {temporada}</h3>
          <ul className={estilos.lista}>
            {deLaTemporada.map((p) => (
              <li key={p.id}>
                <span className={estilos.fila}>
                  <strong>
                    {p.nombre}
                    {p.id === actualId && ' (actual)'}
                  </strong>
                  <span className={estilos.secundario}>{p.categoria}</span>
                </span>
                <button
                  type="button"
                  className={estilos.iconoAccion}
                  onClick={() => setEditando(p)}
                  aria-label={`Editar ${p.nombre} ${p.temporada}`}
                >
                  <Pencil aria-hidden size={18} />
                </button>
                <button
                  type="button"
                  className={`${estilos.iconoAccion} ${estilos.peligro}`}
                  onClick={() => setBorrando(p)}
                  aria-label={`Borrar ${p.nombre} ${p.temporada}`}
                >
                  <Trash2 aria-hidden size={18} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className={estilos.acciones}>
        <Boton
          variante="secundario"
          icono={<Plus aria-hidden size={18} />}
          onClick={() => setCreando(true)}
        >
          Nueva plantilla
        </Boton>
      </div>

      <NuevaPlantilla
        abierta={creando}
        alCerrar={() => setCreando(false)}
        clubes={[club]}
        plantillas={delClub}
        alCrear={() => setCreando(false)}
      />

      <HojaInferior
        abierta={editando !== null}
        alCerrar={() => setEditando(null)}
        titulo={editando ? `Editar ${editando.nombre} ${editando.temporada}` : 'Editar plantilla'}
      >
        {editando && (
          <DatosPlantilla
            plantilla={editando}
            alGuardar={() => setEditando(null)}
            alCancelar={() => setEditando(null)}
          />
        )}
      </HojaInferior>

      <BorrarPlantilla
        plantilla={borrando}
        alCerrar={() => setBorrando(null)}
        alBorrar={(p) => {
          setBorrando(null)
          // Si se borra la plantilla en la que se está, se vuelve al selector
          if (p.id === actualId) navegar('/plantillas', { replace: true })
        }}
      />
    </>
  )
}

// Borrar exige escribir el nombre exacto de la plantilla, igual que la API
function BorrarPlantilla({
  plantilla,
  alCerrar,
  alBorrar,
}: {
  plantilla: Plantilla | null
  alCerrar: () => void
  alBorrar: (plantilla: Plantilla) => void
}) {
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [confirmacion, setConfirmacion] = useState('')
  const [error, setError] = useState<string>()

  const borrar = useMutation({
    mutationFn: (p: Plantilla) =>
      enviar(
        api.DELETE('/api/plantillas/{id}', {
          params: { path: { id: p.id } },
          body: { confirmacion },
        }),
      ),
    onSuccess: async (_, p) => {
      setConfirmacion('')
      alBorrar(p)
      await cliente.invalidateQueries({ queryKey: CLAVE_PLANTILLAS })
      avisar({ tipo: 'exito', mensaje: `Plantilla ${p.nombre} ${p.temporada} borrada` })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido borrar'),
  })

  const coincide = plantilla !== null && confirmacion.trim() === plantilla.nombre

  function enviarFormulario(e: FormEvent) {
    e.preventDefault()
    if (plantilla && coincide) borrar.mutate(plantilla)
  }

  const cerrar = () => {
    setConfirmacion('')
    setError(undefined)
    alCerrar()
  }

  return (
    <HojaInferior
      abierta={plantilla !== null}
      alCerrar={cerrar}
      titulo={plantilla ? `Borrar ${plantilla.nombre} ${plantilla.temporada}` : 'Borrar plantilla'}
    >
      {plantilla && (
        <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
          <p className={estilos.aviso}>
            Se borrarán sus fichas, su cuerpo técnico y todos sus datos (entrenos, partidos,
            multas). Los jugadores siguen en el club. No se puede deshacer.
          </p>
          <Campo
            etiqueta={`Escribe ${plantilla.nombre} para confirmar`}
            autoComplete="off"
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            error={error}
          />
          <div className={estilos.acciones}>
            <Boton variante="secundario" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton
              type="submit"
              variante="peligro"
              disabled={!coincide}
              cargando={borrar.isPending}
              icono={<Trash2 aria-hidden size={18} />}
            >
              Borrar plantilla
            </Boton>
          </div>
        </form>
      )}
    </HojaInferior>
  )
}
