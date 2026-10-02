import { Check, ChevronRight } from 'lucide-react'
import { agruparPlantillas, type Plantilla } from './datos'
import estilos from './ListaPlantillas.module.css'

type Props = {
  plantillas: Plantilla[]
  actualId?: string
  alElegir: (plantilla: Plantilla) => void
}

// Plantillas agrupadas por club y temporada (la más reciente primero), con su categoría
export function ListaPlantillas({ plantillas, actualId, alElegir }: Props) {
  const grupos = agruparPlantillas(plantillas)
  const variosClubes = grupos.length > 1

  return (
    <div className={estilos.lista}>
      {grupos.map(({ club, temporadas }) => (
        <section key={club.id} className={estilos.club} aria-label={club.nombre}>
          {variosClubes && <h2 className={estilos.nombreClub}>{club.nombre}</h2>}
          {temporadas.map(({ temporada, plantillas: deLaTemporada }) => (
            <div key={temporada} className={estilos.temporada}>
              <h3 className={estilos.nombreTemporada}>Temporada {temporada}</h3>
              <ul className={estilos.plantillas}>
                {deLaTemporada.map((p) => {
                  const actual = p.id === actualId
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={estilos.plantilla}
                        onClick={() => alElegir(p)}
                        aria-current={actual ? 'true' : undefined}
                      >
                        <span className={estilos.texto}>
                          <span className={estilos.nombre}>{p.nombre}</span>
                          <span className={estilos.detalle}>
                            {p.categoria}
                            {variosClubes ? '' : ` · ${club.nombre}`}
                          </span>
                        </span>
                        {actual ? (
                          <Check aria-label="Plantilla actual" size={20} />
                        ) : (
                          <ChevronRight aria-hidden size={20} />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
