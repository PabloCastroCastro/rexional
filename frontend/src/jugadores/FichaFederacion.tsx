import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Selector } from '../componentes/Selector'
import { nombreCompleto } from './datos'
import estilos from './Jugadores.module.css'

// Ficha del equipo de la federación en PDF (GH-197): se lee sin guardar nada y se revisa cada
// jugador antes de crear la plantilla o de añadirlos a una que ya existe. El estado de cada fila
// depende de la temporada y de la plantilla: se calcula aquí, con las fichas de los jugadores del club.

export type FichaLeida = components['schemas']['FichaEquipoLeida']
type JugadorLote = { jugadorId: string } | { nombre: string; apellidos: string | null }

export type FilaFicha = {
  ficha: string
  nombre: string
  apellidos: string | null
  // Jugador del club con el que se empareja; null, nuevo en el club
  jugadorId: string | null
  incluida: boolean
}

export const filasDe = (leida: FichaLeida): FilaFicha[] =>
  leida.jugadores.map((j) => ({
    ficha: j.ficha,
    nombre: j.nombre,
    apellidos: j.apellidos,
    jugadorId: j.jugadorId,
    incluida: true,
  }))

type Estado =
  | { tipo: 'nuevo' }
  | { tipo: 'club' }
  | { tipo: 'enPlantilla' }
  | { tipo: 'otra'; plantilla: string }

type Destino = { temporada: string; plantillaId: string | null }

function estadoDe(fila: FilaFicha, leida: FichaLeida, { temporada, plantillaId }: Destino): Estado {
  if (!fila.jugadorId) return { tipo: 'nuevo' }
  const jugador = leida.club.find((j) => j.id === fila.jugadorId)
  if (jugador?.fichas.some((f) => f.plantillaId === plantillaId)) return { tipo: 'enPlantilla' }
  const otra = jugador?.fichas.find((f) => f.temporada === temporada && f.tipo === 'propia')
  return otra ? { tipo: 'otra', plantilla: otra.plantilla } : { tipo: 'club' }
}

const seAnade = (estado: Estado) => estado.tipo === 'nuevo' || estado.tipo === 'club'

// Lo que se envía al confirmar: las filas marcadas que se pueden añadir
export const jugadoresDelLote = (
  filas: FilaFicha[],
  leida: FichaLeida,
  destino: Destino,
): JugadorLote[] =>
  filas.flatMap((f): JugadorLote[] => {
    if (!f.incluida || !seAnade(estadoDe(f, leida, destino))) return []
    return f.jugadorId
      ? [{ jugadorId: f.jugadorId }]
      : [{ nombre: f.nombre.trim(), apellidos: f.apellidos?.trim() || null }]
  })

// Botón para elegir el PDF; lo lee al momento
export function SubirFicha({
  clubId,
  texto,
  variante = 'secundario',
  alLeer,
}: {
  clubId: string
  texto: string
  variante?: 'primario' | 'secundario'
  alLeer: (leida: FichaLeida) => void
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const leer = useMutation({
    mutationFn: (archivo: File) =>
      datos(
        api.POST('/api/clubes/{cid}/ficha-federacion', {
          params: { path: { cid: clubId } },
          // El contrato lo describe como binario (string): se envía el archivo en un formulario
          body: { archivo: archivo.name },
          bodySerializer: () => {
            const formulario = new FormData()
            formulario.append('archivo', archivo)
            return formulario
          },
        }),
      ),
    onMutate: () => setError(null),
    onSuccess: alLeer,
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido leer la ficha'),
  })
  return (
    <>
      <input
        ref={entrada}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        aria-label="Archivo de la ficha del equipo en PDF"
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          e.target.value = ''
          if (archivo) leer.mutate(archivo)
        }}
      />
      {error && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      <div className={estilos.acciones}>
        <Boton
          variante={variante}
          icono={<FileUp aria-hidden size={18} />}
          cargando={leer.isPending}
          onClick={() => entrada.current?.click()}
        >
          {texto}
        </Boton>
      </div>
    </>
  )
}

const TEXTO_ESTADO: Record<Exclude<Estado['tipo'], 'otra'>, string> = {
  nuevo: 'Nuevo en el club',
  club: 'Ya es del club',
  enPlantilla: 'Ya está en la plantilla',
}

// Vista previa: una fila por jugador de la ficha, que se puede desmarcar, emparejar con otro
// jugador del club o corregir de nombre. Debajo, quién de la plantilla no está en la ficha y el
// cuerpo técnico, solo para saberlo.
export function VistaPreviaFicha({
  leida,
  filas,
  alCambiar,
  destino,
  ausentes = [],
}: {
  leida: FichaLeida
  filas: FilaFicha[]
  alCambiar: (filas: FilaFicha[]) => void
  destino: Destino
  ausentes?: string[]
}) {
  const [editando, setEditando] = useState<number | null>(null)
  const cambiar = (i: number, cambios: Partial<FilaFicha>) =>
    alCambiar(filas.map((f, j) => (j === i ? { ...f, ...cambios } : f)))
  const estados = filas.map((f) => estadoDe(f, leida, destino))
  const lote = filas.filter((f, i) => f.incluida && seAnade(estados[i] ?? { tipo: 'nuevo' }))
  const nuevos = lote.filter((f) => !f.jugadorId).length

  return (
    <section className={estilos.seccion} aria-label="Jugadores de la ficha">
      <p className={estilos.secundario} aria-live="polite">
        {lote.length === 0
          ? 'No se añadirá ningún jugador.'
          : `Se añadirán ${lote.length} ${lote.length === 1 ? 'jugador' : 'jugadores'}: ${nuevos} ${nuevos === 1 ? 'nuevo' : 'nuevos'} en el club y ${lote.length - nuevos} que ya ${lote.length - nuevos === 1 ? 'es' : 'son'} del club.`}
      </p>
      <ul className={estilos.filasFicha}>
        {filas.map((f, i) => {
          const estado = estados[i] ?? { tipo: 'nuevo' }
          const jugador = f.jugadorId ? leida.club.find((j) => j.id === f.jugadorId) : null
          const nombre = jugador ? nombreCompleto(jugador) : nombreCompleto(f) || f.ficha
          const posible = seAnade(estado)
          return (
            <li key={f.ficha}>
              <div className={estilos.filaFicha}>
                <label>
                  <input
                    type="checkbox"
                    checked={posible && f.incluida}
                    disabled={!posible}
                    onChange={(e) => cambiar(i, { incluida: e.target.checked })}
                  />
                  <span className={estilos.texto}>
                    <strong>{nombre}</strong>
                    <span className={estilos.secundario}>
                      {estado.tipo === 'otra' ? (
                        <>
                          <AlertTriangle aria-hidden size={14} /> Tiene ficha en {estado.plantilla}{' '}
                          en {destino.temporada}: no se añade
                        </>
                      ) : (
                        TEXTO_ESTADO[estado.tipo]
                      )}
                      {jugador && ` · En la ficha: ${f.ficha}`}
                    </span>
                  </span>
                </label>
                <Boton
                  variante="texto"
                  aria-expanded={editando === i}
                  aria-label={`Corregir a ${nombre}`}
                  onClick={() => setEditando(editando === i ? null : i)}
                >
                  {editando === i ? 'Listo' : 'Corregir'}
                </Boton>
              </div>
              {editando === i && (
                <div className={estilos.correccion}>
                  <Selector
                    etiqueta="Jugador del club"
                    value={f.jugadorId ?? ''}
                    onChange={(e) => cambiar(i, { jugadorId: e.target.value || null })}
                  >
                    <option value="">Ninguno: nuevo en el club</option>
                    {leida.club.map((j) => (
                      <option key={j.id} value={j.id}>
                        {nombreCompleto(j)}
                      </option>
                    ))}
                  </Selector>
                  {!f.jugadorId && (
                    <div className={estilos.dosColumnas}>
                      <Campo
                        etiqueta="Nombre"
                        autoComplete="off"
                        value={f.nombre}
                        onChange={(e) => cambiar(i, { nombre: e.target.value })}
                      />
                      <Campo
                        etiqueta="Apellidos"
                        autoComplete="off"
                        value={f.apellidos ?? ''}
                        onChange={(e) => cambiar(i, { apellidos: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {ausentes.length > 0 && (
        <p className={estilos.aviso}>
          <AlertTriangle aria-hidden size={16} />
          <span>
            No están en la ficha: {ausentes.join(', ')}. Siguen en la plantilla; si se han ido,
            dalos de baja.
          </span>
        </p>
      )}
      {leida.cuerpoTecnico.length > 0 && (
        <details className={estilos.cuerpoTecnico}>
          <summary>Cuerpo técnico · {leida.cuerpoTecnico.length}</summary>
          <ul>
            {leida.cuerpoTecnico.map((p) => (
              <li key={p.ficha}>
                <strong>{nombreCompleto(p)}</strong>
                {p.funcion && <span className={estilos.secundario}> · {p.funcion}</span>}
              </li>
            ))}
          </ul>
          <p className={estilos.secundario}>No se añaden: es para saber a quién invitar.</p>
        </details>
      )}
    </section>
  )
}

// Validación antes de confirmar: los nuevos necesitan nombre
export const faltaNombre = (filas: FilaFicha[]) =>
  filas.some((f) => f.incluida && !f.jugadorId && !f.nombre.trim())
