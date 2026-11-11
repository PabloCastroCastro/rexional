import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
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
}: {
  plantillaId: string
  alElegir: (jugador: JugadorInvitable) => void
  excluir?: Set<string>
}) {
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    const espera = setTimeout(() => setBusqueda(texto.trim()), 250)
    return () => clearTimeout(espera)
  }, [texto])

  const resultados = useInvitables(plantillaId, busqueda, true)
  const lista = resultados.data?.filter((j) => !excluir?.has(j.jugadorId))

  return (
    <div className={estilos.buscador}>
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
              <button type="button" onClick={() => alElegir(j)}>
                <strong>{nombreCompleto(j)}</strong>
                <span className={estilos.secundario}>{j.plantilla}</span>
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
