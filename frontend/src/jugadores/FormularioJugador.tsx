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
import { BuscadorInvitables } from './BuscadorInvitables'
import {
  CLAVE_JUGADORES,
  type JugadorClub,
  type JugadorInvitable,
  type JugadorPlantilla,
  nombreCompleto,
  POSICIONES,
  type Posicion,
  useBuscarJugadores,
} from './datos'
import estilos from './Jugadores.module.css'

// Alta: un jugador nuevo en el club, uno que ya es del club o un invitado (GH-188): de otra plantilla
// del club o de fuera, con su procedencia. Edición: datos del jugador y de su ficha; al reactivar con
// el dorsal ocupado se abre con el error para elegir otro.
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

  const [origen, setOrigen] = useState<'nuevo' | 'club' | 'invitado'>('nuevo')
  const [elegido, setElegido] = useState<JugadorClub | null>(null)
  const [invitado, setInvitado] = useState<JugadorInvitable | null>(null)
  // Invitado que no es del club: alta rápida con su procedencia
  const [deFuera, setDeFuera] = useState(false)
  const [procedencia, setProcedencia] = useState('')
  const [enDinamica, setEnDinamica] = useState(editando?.enDinamica ?? false)
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
              ...(editando.tipo === 'invitado' &&
                enDinamica !== editando.enDinamica && { enDinamica }),
            },
          }),
        )
      }
      return datos(
        api.POST('/api/plantillas/{id}/jugadores', {
          params: { path: { id: plantilla.id } },
          body:
            origen === 'invitado'
              ? invitado
                ? { invitado: true, jugadorId: invitado.jugadorId, enDinamica, ...ficha }
                : {
                    invitado: true,
                    nombre: nombre.trim(),
                    apellidos: apellidos.trim() || null,
                    procedencia: procedencia.trim(),
                    enDinamica,
                    ...ficha,
                  }
              : origen === 'club' && elegido
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
    if (origen === 'invitado' && !editando && !invitado && !deFuera) {
      setErrores({ general: 'Elige un jugador de otra plantilla o da de alta a alguien de fuera' })
      return
    }
    if (origen === 'invitado' && deFuera && !procedencia.trim()) {
      setErrores({ procedencia: 'Indica de dónde viene' })
      return
    }
    guardar.mutate()
  }

  const cambiarOrigen = (nuevo: typeof origen) => {
    setOrigen(nuevo)
    setErrores({})
  }

  const pidiendoNombre =
    editando !== null || origen === 'nuevo' || (origen === 'invitado' && deFuera)
  const pidiendoFicha =
    pidiendoNombre ||
    (origen === 'club' && elegido !== null) ||
    (origen === 'invitado' && invitado !== null)
  const esInvitado = editando ? editando.tipo === 'invitado' : origen === 'invitado'

  return (
    <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
      {!editando && (
        <fieldset className={estilos.segmentos}>
          <legend className="solo-lectores">Tipo de alta</legend>
          <button
            type="button"
            aria-pressed={origen === 'nuevo'}
            onClick={() => cambiarOrigen('nuevo')}
          >
            Nuevo en el club
          </button>
          <button
            type="button"
            aria-pressed={origen === 'club'}
            onClick={() => cambiarOrigen('club')}
          >
            Ya es del club
          </button>
          <button
            type="button"
            aria-pressed={origen === 'invitado'}
            onClick={() => cambiarOrigen('invitado')}
          >
            Invitado
          </button>
        </fieldset>
      )}

      {!editando && origen === 'invitado' && !deFuera && (
        <>
          {invitado ? (
            <div className={estilos.elegido}>
              <span>
                <strong>{nombreCompleto(invitado)}</strong>
                <span className={estilos.secundario}>{invitado.plantilla}</span>
              </span>
              <Boton variante="texto" onClick={() => setInvitado(null)}>
                Cambiar
              </Boton>
            </div>
          ) : (
            <BuscadorInvitables plantillaId={plantilla.id} alElegir={setInvitado} />
          )}
          {!invitado && (
            <Boton variante="texto" onClick={() => setDeFuera(true)}>
              Es de fuera del club
            </Boton>
          )}
        </>
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
      ) : origen !== 'club' ? null : elegido ? (
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

      {!editando && origen === 'invitado' && deFuera && (
        <>
          <Campo
            etiqueta="Procedencia"
            required
            autoComplete="off"
            value={procedencia}
            onChange={(e) => setProcedencia(e.target.value)}
            error={errores.procedencia}
            ayuda="De dónde viene: un club asociado, a prueba…"
          />
          <div className={estilos.atajos}>
            <Boton variante="secundario" onClick={() => setProcedencia('A prueba')}>
              A prueba
            </Boton>
            <Boton variante="secundario" onClick={() => setProcedencia('Club asociado: ')}>
              Club asociado
            </Boton>
            <Boton variante="texto" onClick={() => setDeFuera(false)}>
              Buscar en el club
            </Boton>
          </div>
        </>
      )}

      {pidiendoFicha && esInvitado && (
        <label className={estilos.interruptor}>
          <input
            type="checkbox"
            role="switch"
            aria-checked={enDinamica}
            checked={enDinamica}
            onChange={(e) => setEnDinamica(e.target.checked)}
          />
          <span>
            En la dinámica del equipo
            <span className={estilos.secundario}>
              Apagado: solo partidos. Encendido: también entrenos y multas.
            </span>
          </span>
        </label>
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
            ayuda={esInvitado ? 'Opcional; puede coincidir con otro' : 'Opcional, de 0 a 99'}
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
