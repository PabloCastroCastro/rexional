import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Campo } from '../componentes/Campo'
import { type JugadorInvitable, nombreCompleto, useInvitables } from './datos'
import estilos from './Jugadores.module.css'

// Busca, mientras se escribe, entre los jugadores con ficha en las otras plantillas del club esta
// temporada (GH-188). Los que ya están en esta plantilla no salen. `excluir`, los que ya se han
// elegido en la pantalla
export function BuscadorInvitables({
  plantillaId,
  alElegir,
  excluir,
  enfocar = false,
  accion,
}: {
  plantillaId: string
  alElegir: (jugador: JugadorInvitable) => void
  excluir?: Set<string>
  // Con el foco en el campo al aparecer (al desplegarlo en la convocatoria, GH-292)
  enfocar?: boolean
  // El texto de la acción de cada sugerencia («Convocar»); con él, también la marca «Invitado»
  accion?: string
}) {
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enfocar) return
    const campo = caja.current?.querySelector('input')
    // Al centro: abajo puede haber una barra fija que lo taparía
    campo?.focus({ preventScroll: true })
    campo?.scrollIntoView?.({ block: 'center' })
  }, [enfocar])

  useEffect(() => {
    const espera = setTimeout(() => setBusqueda(texto.trim()), 250)
    return () => clearTimeout(espera)
  }, [texto])

  const resultados = useInvitables(plantillaId, busqueda, true)
  const lista = resultados.data?.filter((j) => !excluir?.has(j.jugadorId))

  return (
    <div className={estilos.buscador} ref={caja}>
      <Campo
        etiqueta="Buscar en otras plantillas del club"
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
      ) : lista?.length === 0 ? (
        <p className={estilos.secundario}>
          <Search aria-hidden size={14} />{' '}
          {busqueda
            ? 'No hay jugadores de otras plantillas con ese nombre.'
            : 'No hay jugadores de otras plantillas para invitar.'}
        </p>
      ) : (
        <ul className={estilos.resultados} aria-label="Jugadores de otras plantillas">
          {lista?.map((j) => (
            <li key={j.jugadorId}>
              <button
                type="button"
                className={accion ? estilos.conAccion : undefined}
                onClick={() => alElegir(j)}
              >
                <span className={estilos.datosInvitable}>
                  <strong>
                    {nombreCompleto(j)}
                    {accion && <MarcaInvitado />}
                  </strong>
                  <span className={estilos.secundario}>{j.plantilla}</span>
                </span>
                {accion && <span className={estilos.accionInvitable}>{accion}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Marca de invitado junto al nombre, igual en todas las listas
export function MarcaInvitado() {
  return <span className={estilos.marcaInvitado}>Invitado</span>
}
