import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, ShieldAlert } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, datos, erroresPorCampo } from '../api/cliente'
import type { components } from '../api/esquema'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { HojaInferior } from '../componentes/HojaInferior'
import { CLAVE_PARTIDOS } from '../partidos/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_JUGADORES } from './datos'
import { diaCorto } from './Lesiones'
import estilos from './Sanciones.module.css'

// Sanciones de los jugadores (GH-231): se calculan en el servidor con las tarjetas de los partidos y
// las reglas de la plantilla. Aquí, la marca de las listas, la franja de la ficha y la hoja para
// corregir los partidos de una sanción.

export type SancionesJugador = components['schemas']['SancionesJugador']
export type Sancion = components['schemas']['Sancion']
type SancionesPlantilla = components['schemas']['SancionesPlantilla']

const claveSanciones = (plantillaId: string) =>
  [...CLAVE_PARTIDOS, plantillaId, 'sanciones'] as const

export const useSanciones = (plantillaId: string) =>
  useQuery({
    queryKey: claveSanciones(plantillaId),
    queryFn: () =>
      datos(api.GET('/api/plantillas/{id}/sanciones', { params: { path: { id: plantillaId } } })),
  })

// Las de un jugador, o undefined si no tiene nada
export const sancionesDe = (datosPlantilla: SancionesPlantilla | undefined, jugadorId: string) =>
  datosPlantilla?.jugadores.find((j) => j.jugadorId === jugadorId)

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export const TIPO: Record<Sancion['tipo'], string> = {
  roja: 'roja directa',
  doble_amarilla: 'doble amarilla',
  ciclo: 'ciclo de amarillas',
}

// «Sancionado · 1 partido», para la convocatoria
export const textoSancion = (partidos: number) =>
  `Sancionado · ${plural(partidos, 'partido', 'partidos')}`

// Marca de las listas: sancionado (con lo que le queda, si se sabe) o apercibido
export function MarcaSancion({
  sanciones,
  partidos,
}: {
  sanciones?: SancionesJugador
  partidos?: number
}) {
  const pendientes =
    partidos ?? sanciones?.pendientes.reduce((total, p) => total + p.partidos, 0) ?? 0
  if (pendientes > 0) {
    return (
      <span className={estilos.marca} data-tipo="sancion">
        <ShieldAlert aria-hidden size={14} />
        {partidos === undefined ? 'Sancionado' : textoSancion(partidos)}
      </span>
    )
  }
  if (sanciones?.apercibido.length) {
    return (
      <span className={estilos.marca} data-tipo="apercibido">
        <ShieldAlert aria-hidden size={14} />
        Apercibido
      </span>
    )
  }
  return null
}

// En la ficha: lo que le queda por cumplir, sanción a sanción, y si está apercibido
export function FranjaSancion({
  sanciones,
  gestiona,
  alCorregir,
}: {
  sanciones: SancionesJugador
  gestiona: boolean
  alCorregir: (sancion: Sancion) => void
}) {
  const vigentes = sanciones.sanciones.filter((s) => s.cumplidos < s.partidos)
  if (vigentes.length === 0 && sanciones.apercibido.length === 0) return null
  return (
    <section
      className={estilos.franja}
      aria-label="Sanción"
      data-tipo={vigentes.length ? 'sancion' : 'apercibido'}
    >
      <ShieldAlert aria-hidden size={20} className={estilos.icono} />
      <div className={estilos.texto}>
        {sanciones.pendientes.map((p) => (
          <strong key={p.competicion}>
            Sancionado · {plural(p.partidos, 'partido', 'partidos')} en {p.competicion}
          </strong>
        ))}
        {vigentes.map((s) => (
          <span key={`${s.partidoId}-${s.tipo}`} className={estilos.detalle}>
            <span>
              Por {TIPO[s.tipo]} vs {s.rival} ({diaCorto(s.fecha)})
              {s.cumplidos > 0 && ` · ${s.cumplidos} de ${s.partidos} cumplidos`}
              {s.ajustada &&
                ` · corregida (${plural(s.calculados, 'partido', 'partidos')} por reglas)`}
              {s.nota && ` · ${s.nota}`}
            </span>
            {gestiona && (
              <Boton
                variante="texto"
                className={estilos.corregir}
                icono={<Pencil aria-hidden size={16} />}
                aria-label={`Corregir la sanción por ${TIPO[s.tipo]} vs ${s.rival}`}
                title="Corregir"
                onClick={() => alCorregir(s)}
              />
            )}
          </span>
        ))}
        {sanciones.apercibido.map((a) => (
          <span key={a.competicion}>
            Apercibido · {plural(a.amarillas, 'amarilla', 'amarillas')} en {a.competicion}
          </span>
        ))}
      </div>
    </section>
  )
}

// Corregir los partidos de una sanción, como decida el comité de competición
export function HojaCorregirSancion({
  jugadorId,
  sancion,
  alCerrar,
}: {
  jugadorId: string
  sancion: Sancion | null
  alCerrar: () => void
}) {
  return (
    <HojaInferior abierta={sancion !== null} alCerrar={alCerrar} titulo="Corregir la sanción">
      {sancion && <FormularioSancion jugadorId={jugadorId} sancion={sancion} alCerrar={alCerrar} />}
    </HojaInferior>
  )
}

function FormularioSancion({
  jugadorId,
  sancion,
  alCerrar,
}: {
  jugadorId: string
  sancion: Sancion
  alCerrar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [partidos, setPartidos] = useState(String(sancion.partidos))
  const [nota, setNota] = useState(sancion.nota ?? '')
  const [errores, setErrores] = useState<Record<string, string>>({})

  const guardar = useMutation({
    mutationFn: (cuerpo: { partidos: number | null; nota: string | null }) =>
      datos(
        api.PUT('/api/plantillas/{id}/sanciones/ajuste', {
          params: { path: { id: plantilla.id } },
          body: { partidoId: sancion.partidoId, jugadorId, tipo: sancion.tipo, ...cuerpo },
        }),
      ),
    onSuccess: async (nuevas) => {
      cliente.setQueryData(claveSanciones(plantilla.id), nuevas)
      await Promise.all(
        [CLAVE_PARTIDOS, CLAVE_JUGADORES].map((queryKey) =>
          cliente.invalidateQueries({ queryKey }),
        ),
      )
      alCerrar()
      avisar({ tipo: 'exito', mensaje: 'Sanción corregida' })
    },
    onError: (e) => {
      const porCampo = erroresPorCampo(e)
      setErrores(
        Object.keys(porCampo).length
          ? porCampo
          : { general: e instanceof Error ? e.message : 'No se ha podido guardar' },
      )
    },
  })

  function alEnviar(e: FormEvent) {
    e.preventDefault()
    const n = Number(partidos)
    if (partidos.trim() === '' || !Number.isInteger(n) || n < 0 || n > 20) {
      return setErrores({ partidos: 'Un número entero de 0 a 20' })
    }
    setErrores({})
    guardar.mutate({ partidos: n, nota: nota.trim() || null })
  }

  return (
    <form className={estilos.formulario} onSubmit={alEnviar} noValidate>
      <p className={estilos.contexto}>
        Por {TIPO[sancion.tipo]} vs {sancion.rival} ({diaCorto(sancion.fecha)}), en{' '}
        {sancion.competicion}. Por las reglas de la plantilla son{' '}
        {plural(sancion.calculados, 'partido', 'partidos')}.
      </p>
      <Campo
        etiqueta="Partidos de sanción"
        type="number"
        inputMode="numeric"
        min={0}
        max={20}
        step={1}
        value={partidos}
        onChange={(e) => setPartidos(e.target.value)}
        error={errores.partidos}
        ayuda="Los que decida el comité de competición. Con 0, queda anulada."
      />
      <Campo
        etiqueta="Nota (opcional)"
        maxLength={140}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        error={errores.nota}
      />
      {errores.general && (
        <p className={estilos.error} role="alert">
          {errores.general}
        </p>
      )}
      <div className={estilos.pie}>
        {sancion.ajustada && (
          <Boton
            variante="texto"
            className={estilos.reglas}
            cargando={guardar.isPending}
            onClick={() => guardar.mutate({ partidos: null, nota: null })}
          >
            Volver a las reglas
          </Boton>
        )}
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={guardar.isPending}>
          Guardar
        </Boton>
      </div>
    </form>
  )
}
