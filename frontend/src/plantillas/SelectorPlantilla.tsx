import { Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { Boton } from '../componentes/Boton'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { type Club, type Plantilla, useClubes, usePlantillas } from './datos'
import { ListaPlantillas } from './ListaPlantillas'
import { NuevaPlantilla } from './NuevaPlantilla'

type Props = {
  actualId?: string
  alElegir: (plantillaId: string) => void
}

// Lista de plantillas para elegir la activa, con "Nueva plantilla" para los administradores del club.
// Se usa como página tras el login y dentro de la hoja de cambio de plantilla.
export function SelectorPlantilla({ actualId, alElegir }: Props) {
  const plantillas = usePlantillas()
  const clubes = useClubes()
  const [creando, setCreando] = useState(false)

  const lista: Plantilla[] = plantillas.data ?? []
  const administrados: Club[] = (clubes.data ?? []).filter((c) => c.esAdmin)
  const nueva = administrados.length > 0 && (
    <Boton
      variante="secundario"
      icono={<Plus aria-hidden size={18} />}
      onClick={() => setCreando(true)}
    >
      Nueva plantilla
    </Boton>
  )

  return (
    <>
      {lista.length === 0 ? (
        <EstadoVacio
          icono={<Users size={32} />}
          titulo={
            administrados.length > 0
              ? 'Crea la primera plantilla'
              : 'Todavía no tienes acceso a ninguna plantilla'
          }
          descripcion={
            administrados.length > 0
              ? 'Una plantilla es una categoría del club en una temporada, p. ej. Senior 2026-27.'
              : 'Pide al administrador de tu club que te dé acceso.'
          }
          accion={nueva}
        />
      ) : (
        <>
          <ListaPlantillas
            plantillas={lista}
            actualId={actualId}
            alElegir={(p) => alElegir(p.id)}
          />
          {nueva}
        </>
      )}
      {administrados.length > 0 && (
        <NuevaPlantilla
          abierta={creando}
          alCerrar={() => setCreando(false)}
          clubes={administrados}
          plantillas={lista}
          alCrear={(p) => {
            setCreando(false)
            alElegir(p.id)
          }}
        />
      )}
    </>
  )
}
