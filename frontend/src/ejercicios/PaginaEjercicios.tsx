import { Dumbbell, Image, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  CATEGORIAS,
  type Categoria,
  type Filtros,
  textoDetalles,
  useEjercicios,
  useEtiquetas,
} from './datos'
import estilos from './Ejercicios.module.css'
import { FormularioEjercicio } from './FormularioEjercicio'

// Biblioteca de ejercicios del club, en la pestaña Entrenos: búsqueda, filtros y crear. Los filtros
// van en la dirección, para volver a la lista tal como estaba.
export function PaginaEjercicios() {
  const plantilla = usePlantillaActiva()
  const navegar = useNavigate()
  const gestiona = puedeGestionarJugadores(plantilla)
  const [parametros, setParametros] = useSearchParams()
  const [texto, setTexto] = useState(parametros.get('q') ?? '')
  const [creando, setCreando] = useState(false)
  const filtros: Filtros = {
    q: parametros.get('q') || undefined,
    categoria: (parametros.get('categoria') as Categoria | null) || undefined,
    etiqueta: parametros.get('etiqueta') || undefined,
    archivados: parametros.get('archivados') === 'si' ? 'si' : 'no',
  }
  const ejercicios = useEjercicios(plantilla.clubId, filtros)
  const etiquetas = useEtiquetas(plantilla.clubId)

  // Siempre sobre los parámetros actuales: dos cambios seguidos (la búsqueda y un filtro) no se pisan
  const cambiar = (clave: string, valor: string | null) =>
    setParametros(
      (actuales) => {
        const nuevos = new URLSearchParams(actuales)
        if (valor) nuevos.set(clave, valor)
        else nuevos.delete(clave)
        return nuevos
      },
      { replace: true },
    )

  // La búsqueda se lanza al dejar de escribir
  useEffect(() => {
    const espera = setTimeout(() => {
      if (texto.trim() !== (parametros.get('q') ?? '')) cambiar('q', texto.trim() || null)
    }, 300)
    return () => clearTimeout(espera)
  })

  const hayFiltros = Boolean(filtros.q || filtros.categoria || filtros.etiqueta)

  return (
    <div className={estilos.biblioteca}>
      <div className={estilos.buscador}>
        <Search aria-hidden size={18} />
        <input
          type="search"
          placeholder="Buscar ejercicio, etiqueta…"
          aria-label="Buscar ejercicio"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>
      <div className={estilos.filtros}>
        <select
          aria-label="Categoría"
          value={filtros.categoria ?? ''}
          onChange={(e) => cambiar('categoria', e.target.value || null)}
        >
          <option value="">Categorías</option>
          {Object.entries(CATEGORIAS).map(([valor, nombre]) => (
            <option key={valor} value={valor}>
              {nombre}
            </option>
          ))}
        </select>
        {(etiquetas.data?.length ?? 0) > 0 && (
          <select
            aria-label="Etiqueta"
            value={filtros.etiqueta ?? ''}
            onChange={(e) => cambiar('etiqueta', e.target.value || null)}
          >
            <option value="">Etiquetas</option>
            {etiquetas.data?.map((etiqueta) => (
              <option key={etiqueta} value={etiqueta}>
                {etiqueta}
              </option>
            ))}
          </select>
        )}
        <label className={estilos.archivados}>
          <input
            type="checkbox"
            checked={filtros.archivados === 'si'}
            onChange={(e) => cambiar('archivados', e.target.checked ? 'si' : null)}
          />
          Archivados
        </label>
      </div>

      {gestiona && (
        <Boton icono={<Plus aria-hidden size={18} />} onClick={() => setCreando(true)}>
          Nuevo ejercicio
        </Boton>
      )}

      {ejercicios.isPending ? (
        <Cargando />
      ) : ejercicios.isError ? (
        <p className={estilos.error} role="alert">
          {ejercicios.error.message}
        </p>
      ) : ejercicios.data.length === 0 ? (
        <EstadoVacio
          icono={<Dumbbell size={32} />}
          titulo={
            hayFiltros
              ? 'Ningún ejercicio con esa búsqueda'
              : filtros.archivados === 'si'
                ? 'No hay ejercicios archivados'
                : 'La biblioteca está vacía'
          }
          descripcion={
            hayFiltros || filtros.archivados === 'si'
              ? undefined
              : gestiona
                ? 'Crea los ejercicios del club con su explicación, fotos y vídeos: luego se usan al planificar los entrenos.'
                : 'Cuando el cuerpo técnico añada ejercicios, aparecerán aquí.'
          }
        />
      ) : (
        <ul className={estilos.lista} aria-label="Ejercicios">
          {ejercicios.data.map((e) => (
            <li key={e.id}>
              <Link to={e.id} className={estilos.tarjetaEjercicio}>
                {e.urlMiniatura ? (
                  <img src={e.urlMiniatura} alt="" className={estilos.miniatura} loading="lazy" />
                ) : (
                  <span className={estilos.miniatura} aria-hidden="true">
                    <Image size={22} />
                  </span>
                )}
                <span className={estilos.textoTarjeta}>
                  <strong>{e.nombre}</strong>
                  <span className={estilos.secundario}>
                    {[textoDetalles(e), e.archivado && 'archivado'].filter(Boolean).join(' · ')}
                  </span>
                  {e.etiquetas.length > 0 && (
                    <span className={estilos.etiquetas}>
                      {e.etiquetas.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <FormularioEjercicio
        abierta={creando}
        alCerrar={() => setCreando(false)}
        alGuardar={(e) => navegar(e.id)}
      />
    </div>
  )
}
