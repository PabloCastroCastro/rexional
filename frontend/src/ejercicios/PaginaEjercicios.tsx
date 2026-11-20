import { Dumbbell, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { type CSSProperties, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { HojaInferior } from '../componentes/HojaInferior'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  agruparPorCategoria,
  CATEGORIAS,
  type Categoria,
  colorCategoria,
  type Filtros,
  useEjercicios,
  useEtiquetas,
} from './datos'
import estilos from './Ejercicios.module.css'
import { FormularioEjercicio } from './FormularioEjercicio'
import { MiniaturaEjercicio } from './MiniaturaEjercicio'

// Biblioteca de ejercicios del club, en la pestaña Entrenos: el buscador, «Filtros» (categoría,
// etiqueta y archivados, en una hoja) y «＋» para crear (GH-272). Los filtros puestos se ven debajo,
// como chips que se quitan con un toque. Van en la dirección, para volver a la lista tal como estaba.
export function PaginaEjercicios() {
  const plantilla = usePlantillaActiva()
  const navegar = useNavigate()
  const gestiona = puedeGestionarJugadores(plantilla)
  const [parametros, setParametros] = useSearchParams()
  const [texto, setTexto] = useState(parametros.get('q') ?? '')
  const [creando, setCreando] = useState(false)
  const [filtrando, setFiltrando] = useState(false)
  const filtros: Filtros = {
    q: parametros.get('q') || undefined,
    categoria: (parametros.get('categoria') as Categoria | null) || undefined,
    etiqueta: parametros.get('etiqueta') || undefined,
    archivados: parametros.get('archivados') === 'si' ? 'si' : 'no',
  }
  const ejercicios = useEjercicios(plantilla.clubId, filtros)
  const etiquetas = useEtiquetas(plantilla.clubId)

  // Varios parámetros en una sola navegación: dos llamadas seguidas a setParametros parten de los
  // mismos parámetros y la segunda pisa a la primera
  const cambiarVarios = (cambios: Record<string, string | null>) =>
    setParametros(
      (actuales) => {
        const nuevos = new URLSearchParams(actuales)
        for (const [clave, valor] of Object.entries(cambios)) {
          if (valor) nuevos.set(clave, valor)
          else nuevos.delete(clave)
        }
        return nuevos
      },
      { replace: true },
    )
  const cambiar = (clave: string, valor: string | null) => cambiarVarios({ [clave]: valor })

  // La búsqueda se lanza al dejar de escribir
  useEffect(() => {
    const espera = setTimeout(() => {
      if (texto.trim() !== (parametros.get('q') ?? '')) cambiar('q', texto.trim() || null)
    }, 300)
    return () => clearTimeout(espera)
  })

  const hayFiltros = Boolean(filtros.q || filtros.categoria || filtros.etiqueta)
  // Los de la hoja «Filtros»: la categoría, la etiqueta y los archivados
  const puestos = [
    filtros.categoria && {
      clave: 'categoria',
      texto: CATEGORIAS[filtros.categoria],
      color: colorCategoria(filtros.categoria),
    },
    filtros.etiqueta && { clave: 'etiqueta', texto: filtros.etiqueta, color: null },
    filtros.archivados === 'si' && { clave: 'archivados', texto: 'Archivados', color: null },
  ].filter((p) => typeof p === 'object')
  const total = ejercicios.data?.length ?? 0

  return (
    <div className={estilos.biblioteca}>
      <div className={estilos.filaBuscador}>
        <div className={estilos.buscador}>
          <Search aria-hidden size={18} />
          <input
            type="search"
            placeholder="Buscar ejercicio"
            aria-label="Buscar ejercicio"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <Boton
          variante={puestos.length > 0 ? 'primario' : 'secundario'}
          className={estilos.botonFiltros}
          aria-haspopup="dialog"
          aria-label={puestos.length ? `Filtros (${puestos.length})` : 'Filtros'}
          title="Filtros"
          icono={<SlidersHorizontal aria-hidden size={20} />}
          onClick={() => setFiltrando(true)}
        >
          {puestos.length > 0 && (
            <span className={estilos.cuentaFiltros} aria-hidden="true">
              {puestos.length}
            </span>
          )}
        </Boton>
        {gestiona && (
          <Boton
            className={estilos.botonNuevo}
            aria-label="Nuevo ejercicio"
            icono={<Plus aria-hidden size={22} />}
            onClick={() => setCreando(true)}
          />
        )}
      </div>

      {puestos.length > 0 && (
        <ul className={estilos.filtrosPuestos} aria-label="Filtros puestos">
          {puestos.map((p) => (
            <li key={p.clave}>
              <button
                type="button"
                className={estilos.chip}
                style={p.color ? ({ '--color-chip': p.color } as CSSProperties) : undefined}
                aria-label={`Quitar el filtro ${p.texto}`}
                onClick={() => cambiar(p.clave, null)}
              >
                {p.color && <span className={estilos.puntoCategoria} aria-hidden="true" />}
                {p.texto}
                <X aria-hidden size={16} />
              </button>
            </li>
          ))}
        </ul>
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
        // Un grupo por categoría, en el orden de una sesión (GH-274); con una categoría elegida o
        // una búsqueda, solo salen los grupos con resultados
        <div className={estilos.grupos}>
          {agruparPorCategoria(ejercicios.data).map((grupo) => {
            const idGrupo = `grupo-${grupo.categoria ?? 'ninguna'}`
            return (
              <section
                key={idGrupo}
                aria-labelledby={idGrupo}
                className={estilos.grupo}
                style={{ '--color-chip': colorCategoria(grupo.categoria) } as CSSProperties}
              >
                <h2 id={idGrupo} className={estilos.cabeceraGrupo}>
                  <span className={estilos.puntoCategoria} aria-hidden="true" />
                  {grupo.nombre}{' '}
                  <span className={estilos.cuentaGrupo}>
                    {grupo.ejercicios.length}{' '}
                    {/* El espacio, fuera: dentro del texto oculto se pierde al leer el nombre */}
                    <span className="solo-lectores">
                      {grupo.ejercicios.length === 1 ? 'ejercicio' : 'ejercicios'}
                    </span>
                  </span>
                </h2>
                <ul className={estilos.lista} aria-labelledby={idGrupo}>
                  {grupo.ejercicios.map((e) => (
                    <li key={e.id}>
                      <Link to={e.id} className={estilos.tarjetaEjercicio}>
                        <MiniaturaEjercicio
                          url={e.urlMiniatura}
                          categoria={e.categoria}
                          className={estilos.miniatura}
                        />
                        <span className={estilos.textoTarjeta}>
                          <strong>{e.nombre}</strong>
                          {/* La categoría ya la dice el grupo */}
                          {(e.duracionMin || e.archivado) && (
                            <span className={estilos.secundario}>
                              {[e.duracionMin && `${e.duracionMin}'`, e.archivado && 'archivado']
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
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
              </section>
            )
          })}
        </div>
      )}

      {/* Los cambios se aplican al momento: «Ver N» dice cuántos quedan y cierra */}
      <HojaInferior
        abierta={filtrando}
        alCerrar={() => setFiltrando(false)}
        titulo="Filtros"
        pie={
          <>
            <Boton
              variante="secundario"
              disabled={puestos.length === 0}
              onClick={() => cambiarVarios({ categoria: null, etiqueta: null, archivados: null })}
            >
              Quitar filtros
            </Boton>
            <Boton onClick={() => setFiltrando(false)}>
              Ver {total} {total === 1 ? 'ejercicio' : 'ejercicios'}
            </Boton>
          </>
        }
      >
        <div className={estilos.hojaFiltros}>
          <fieldset className={estilos.grupoFiltro}>
            <legend>Categoría</legend>
            <div className={estilos.chipsEtiquetas}>
              {(Object.entries(CATEGORIAS) as [Categoria, string][]).map(([valor, nombre]) => (
                <button
                  key={valor}
                  type="button"
                  className={estilos.chip}
                  style={{ '--color-chip': colorCategoria(valor) } as CSSProperties}
                  aria-pressed={filtros.categoria === valor}
                  onClick={() => cambiar('categoria', filtros.categoria === valor ? null : valor)}
                >
                  <span className={estilos.puntoCategoria} aria-hidden="true" />
                  {nombre}
                </button>
              ))}
            </div>
          </fieldset>
          {(etiquetas.data?.length ?? 0) > 0 && (
            <fieldset className={estilos.grupoFiltro}>
              <legend>Etiquetas</legend>
              <div className={estilos.chipsEtiquetas}>
                {etiquetas.data?.map((etiqueta) => (
                  <button
                    key={etiqueta}
                    type="button"
                    className={estilos.chip}
                    aria-pressed={filtros.etiqueta === etiqueta}
                    onClick={() =>
                      cambiar('etiqueta', filtros.etiqueta === etiqueta ? null : etiqueta)
                    }
                  >
                    {etiqueta}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <label className={estilos.interruptor}>
            <input
              type="checkbox"
              role="switch"
              aria-checked={filtros.archivados === 'si'}
              checked={filtros.archivados === 'si'}
              onChange={(e) => cambiar('archivados', e.target.checked ? 'si' : null)}
            />
            Mostrar archivados
          </label>
        </div>
      </HojaInferior>

      <FormularioEjercicio
        abierta={creando}
        alCerrar={() => setCreando(false)}
        alGuardar={(e) => navegar(e.id)}
      />
    </div>
  )
}
