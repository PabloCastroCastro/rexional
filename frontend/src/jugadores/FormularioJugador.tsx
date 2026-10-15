import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Search, UserPlus } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { api, datos, erroresPorCampo } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { HojaInferior } from '../componentes/HojaInferior'
import { Selector } from '../componentes/Selector'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  CLAVE_JUGADORES,
  type JugadorClub,
  type JugadorPlantilla,
  nombreCompleto,
  POSICIONES,
  type Posicion,
  useBuscarJugadores,
} from './datos'
import estilos from './Jugadores.module.css'

// Alta: un jugador nuevo en el club o uno que ya es del club. Edición: datos del jugador y de su
// ficha; al reactivar con el dorsal ocupado se abre con el error para elegir otro.
export type ModoFormulario =
  | { tipo: 'alta' }
  | { tipo: 'editar'; jugador: JugadorPlantilla; reactivar?: boolean; errorDorsal?: string }

type Props = {
  modo: ModoFormulario | null
  alCerrar: () => void
}

export function FormularioJugador({ modo, alCerrar }: Props) {
  const titulo =
    modo?.tipo === 'editar'
      ? `${modo.reactivar ? 'Reactivar' : 'Editar'} a ${nombreCompleto(modo.jugador)}`
      : 'Añadir jugador'
  return (
    <HojaInferior abierta={modo !== null} alCerrar={alCerrar} titulo={titulo}>
      {/* Se monta al abrir: cada vez empieza con el formulario limpio */}
      {modo && <Contenido modo={modo} alCerrar={alCerrar} />}
    </HojaInferior>
  )
}

const comoDorsal = (texto: string) => (texto.trim() === '' ? null : Number(texto))

function Contenido({ modo, alCerrar }: { modo: ModoFormulario; alCerrar: () => void }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const editando = modo.tipo === 'editar' ? modo.jugador : null

  const [origen, setOrigen] = useState<'nuevo' | 'club'>('nuevo')
  const [elegido, setElegido] = useState<JugadorClub | null>(null)
  const [nombre, setNombre] = useState(editando?.nombre ?? '')
  const [apellidos, setApellidos] = useState(editando?.apellidos ?? '')
  const [dorsal, setDorsal] = useState(editando?.dorsal?.toString() ?? '')
  const [posicion, setPosicion] = useState<Posicion | ''>(editando?.posicion ?? '')
  const [errores, setErrores] = useState<Record<string, string>>(
    modo.tipo === 'editar' && modo.errorDorsal ? { dorsal: modo.errorDorsal } : {},
  )

  const guardar = useMutation({
    mutationFn: () => {
      const ficha = { dorsal: comoDorsal(dorsal), posicion: posicion || null }
      if (editando) {
        return datos(
          api.PATCH('/api/plantillas/{id}/jugadores/{jid}', {
            params: { path: { id: plantilla.id, jid: editando.jugadorId } },
            body: {
              ...ficha,
              ...(nombre.trim() !== editando.nombre && { nombre: nombre.trim() }),
              ...((apellidos.trim() || null) !== editando.apellidos && {
                apellidos: apellidos.trim() || null,
              }),
              ...(modo.tipo === 'editar' && modo.reactivar && { activo: true }),
            },
          }),
        )
      }
      return datos(
        api.POST('/api/plantillas/{id}/jugadores', {
          params: { path: { id: plantilla.id } },
          body:
            origen === 'club' && elegido
              ? { jugadorId: elegido.id, ...ficha }
              : { nombre: nombre.trim(), apellidos: apellidos.trim() || null, ...ficha },
        }),
      )
    },
    onSuccess: async (jugador) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_JUGADORES })
      const mensaje =
        modo.tipo === 'alta'
          ? `${nombreCompleto(jugador)} añadido a la plantilla`
          : modo.reactivar
            ? `${nombreCompleto(jugador)} vuelve a la plantilla`
            : 'Jugador guardado'
      avisar({ tipo: 'exito', mensaje })
      alCerrar()
    },
    onError: (error) => {
      const porCampo = erroresPorCampo(error)
      setErrores(
        Object.keys(porCampo).length > 0
          ? porCampo
          : { general: error instanceof Error ? error.message : 'No se ha podido guardar' },
      )
    },
  })

  function enviarFormulario(e: FormEvent) {
    e.preventDefault()
    setErrores({})
    if (origen === 'club' && !editando && !elegido) {
      setErrores({ general: 'Elige un jugador del club' })
      return
    }
    guardar.mutate()
  }

  const pidiendoNombre = editando !== null || origen === 'nuevo'
  const pidiendoFicha = pidiendoNombre || elegido !== null

  return (
    <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
      {!editando && (
        <fieldset className={estilos.segmentos}>
          <legend className="solo-lectores">Tipo de alta</legend>
          <button
            type="button"
            aria-pressed={origen === 'nuevo'}
            onClick={() => {
              setOrigen('nuevo')
              setErrores({})
            }}
          >
            Nuevo en el club
          </button>
          <button
            type="button"
            aria-pressed={origen === 'club'}
            onClick={() => {
              setOrigen('club')
              setErrores({})
            }}
          >
            Ya es del club
          </button>
        </fieldset>
      )}

      {pidiendoNombre ? (
        <Campo
          etiqueta="Nombre"
          required
          autoComplete="off"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          error={errores.nombre}
        />
      ) : null}
      {pidiendoNombre ? (
        <Campo
          etiqueta="Apellidos"
          autoComplete="off"
          value={apellidos}
          onChange={(e) => setApellidos(e.target.value)}
          error={errores.apellidos}
          ayuda={
            editando
              ? 'Opcionales. Nombre y apellidos son del jugador: cambian en todas sus temporadas.'
              : 'Opcionales.'
          }
        />
      ) : elegido ? (
        <div className={estilos.elegido}>
          <span>
            <strong>{nombreCompleto(elegido)}</strong>
            <span className={estilos.secundario}>{textoTemporadas(elegido)}</span>
          </span>
          <Boton variante="texto" onClick={() => setElegido(null)}>
            Cambiar
          </Boton>
        </div>
      ) : (
        <BuscadorClub temporada={plantilla.temporada} alElegir={setElegido} />
      )}

      {pidiendoFicha && (
        <div className={estilos.dosColumnas}>
          <Campo
            etiqueta="Dorsal"
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            value={dorsal}
            onChange={(e) => setDorsal(e.target.value)}
            error={errores.dorsal}
            ayuda="Opcional, de 0 a 99"
          />
          <Selector
            etiqueta="Posición"
            value={posicion}
            onChange={(e) => setPosicion(e.target.value as Posicion | '')}
            error={errores.posicion}
          >
            <option value="">Sin posición</option>
            {Object.entries(POSICIONES).map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </Selector>
        </div>
      )}

      {errores.general && (
        <p className={estilos.error} role="alert">
          {errores.general}
        </p>
      )}

      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton
          type="submit"
          cargando={guardar.isPending}
          icono={editando ? <Save aria-hidden size={18} /> : <UserPlus aria-hidden size={18} />}
        >
          {editando
            ? modo.tipo === 'editar' && modo.reactivar
              ? 'Reactivar'
              : 'Guardar'
            : 'Añadir'}
        </Boton>
      </div>
    </form>
  )
}

const textoTemporadas = (jugador: JugadorClub) =>
  jugador.temporadas.length > 0
    ? `Temporadas: ${jugador.temporadas.join(', ')}`
    : 'Sin fichas todavía'

// Busca entre los jugadores del club mientras se escribe. Los que ya tienen ficha en la temporada de
// la plantilla no se pueden elegir: un jugador tiene como máximo una ficha por temporada.
function BuscadorClub({
  temporada,
  alElegir,
}: {
  temporada: string
  alElegir: (jugador: JugadorClub) => void
}) {
  const plantilla = usePlantillaActiva()
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    const espera = setTimeout(() => setBusqueda(texto.trim()), 250)
    return () => clearTimeout(espera)
  }, [texto])

  const resultados = useBuscarJugadores(plantilla.clubId, busqueda, true)

  return (
    <div className={estilos.buscador}>
      <Campo
        etiqueta="Buscar en el club"
        type="search"
        autoComplete="off"
        placeholder="Nombre del jugador"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      {resultados.isError ? (
        <p className={estilos.error} role="alert">
          {resultados.error.message}
        </p>
      ) : resultados.data?.length === 0 ? (
        <p className={estilos.secundario}>
          <Search aria-hidden size={14} /> No hay jugadores del club con ese nombre.
        </p>
      ) : (
        <ul className={estilos.resultados} aria-label="Jugadores del club">
          {resultados.data?.map((j) => {
            const ocupado = j.temporadas.includes(temporada)
            return (
              <li key={j.id}>
                <button type="button" disabled={ocupado} onClick={() => alElegir(j)}>
                  <strong>{nombreCompleto(j)}</strong>
                  <span className={estilos.secundario}>
                    {ocupado ? `Ya tiene ficha en ${temporada}` : textoTemporadas(j)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
