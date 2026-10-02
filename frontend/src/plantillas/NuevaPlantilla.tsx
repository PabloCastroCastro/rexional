import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { api, datos, ErrorApi } from '../api/cliente'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { HojaInferior } from '../componentes/HojaInferior'
import {
  CATEGORIAS,
  CLAVE_PLANTILLAS,
  type Club,
  type Plantilla,
  temporadaDe,
  temporadaDesplazada,
} from './datos'
import estilos from './NuevaPlantilla.module.css'

type Props = {
  abierta: boolean
  alCerrar: () => void
  // Clubes que el usuario administra: solo en ellos puede crear plantillas
  clubes: Club[]
  plantillas: Plantilla[]
  alCrear: (plantilla: { id: string }) => void
}

type Errores = Partial<Record<'nombre' | 'categoria' | 'temporada' | 'general', string>>

export function NuevaPlantilla({ abierta, alCerrar, clubes, plantillas, alCrear }: Props) {
  const cliente = useQueryClient()
  const actual = temporadaDe(new Date())
  const temporadas = [temporadaDesplazada(actual, 1), actual, temporadaDesplazada(actual, -1)]

  const [clubId, setClubId] = useState(clubes[0]?.id ?? '')
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState('')
  const [temporada, setTemporada] = useState(actual)
  const [anteriorId, setAnteriorId] = useState('')
  const [errores, setErrores] = useState<Errores>({})
  const ids = { club: useId(), temporada: useId(), anterior: useId(), categorias: useId() }

  // Candidatas a plantilla anterior: del mismo club y de una temporada anterior
  const candidatas = plantillas.filter((p) => p.clubId === clubId && p.temporada < temporada)

  // Propone sola la plantilla con el mismo nombre en la temporada anterior (Senior 2026-27 → Senior 2025-26)
  useEffect(() => {
    const previa = temporadaDesplazada(temporada, -1)
    const mismaPlantilla = plantillas.find(
      (p) =>
        p.clubId === clubId &&
        p.temporada === previa &&
        p.nombre.toLowerCase() === nombre.trim().toLowerCase(),
    )
    if (mismaPlantilla) {
      setAnteriorId(mismaPlantilla.id)
      setCategoria((c) => c || mismaPlantilla.categoria)
    }
  }, [clubId, nombre, temporada, plantillas])

  useEffect(() => {
    if (!abierta) {
      setNombre('')
      setCategoria('')
      setTemporada(actual)
      setAnteriorId('')
      setErrores({})
    }
  }, [abierta, actual])

  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/plantillas', {
          body: {
            clubId,
            nombre: nombre.trim(),
            categoria: categoria.trim(),
            temporada,
            plantillaAnteriorId: anteriorId || null,
          },
        }),
      ),
    onSuccess: async (plantilla) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_PLANTILLAS })
      alCrear(plantilla)
    },
    onError: (error) => {
      if (error instanceof ErrorApi && Array.isArray(error.detalles)) {
        const porCampo: Errores = {}
        for (const d of error.detalles as { campo: keyof Errores; mensaje: string }[])
          porCampo[d.campo] = d.mensaje
        setErrores(porCampo)
      } else if (error instanceof ErrorApi && error.codigo === 'plantilla_duplicada') {
        setErrores({ nombre: error.message })
      } else {
        setErrores({
          general: error instanceof Error ? error.message : 'No se ha podido crear la plantilla',
        })
      }
    },
  })

  function enviar(e: FormEvent) {
    e.preventDefault()
    const faltan: Errores = {}
    if (!nombre.trim()) faltan.nombre = 'Escribe el nombre, p. ej. Senior o Infantil A'
    if (!categoria.trim()) faltan.categoria = 'Elige o escribe la categoría'
    setErrores(faltan)
    if (Object.keys(faltan).length === 0) crear.mutate()
  }

  return (
    <HojaInferior
      abierta={abierta}
      alCerrar={alCerrar}
      titulo="Nueva plantilla"
      pie={
        <>
          <Boton variante="secundario" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton
            type="submit"
            form="nueva-plantilla"
            cargando={crear.isPending}
            icono={<Plus aria-hidden size={18} />}
          >
            Crear
          </Boton>
        </>
      }
    >
      <form id="nueva-plantilla" className={estilos.formulario} onSubmit={enviar} noValidate>
        {errores.general && (
          <p className={estilos.error} role="alert">
            {errores.general}
          </p>
        )}
        {clubes.length > 1 && (
          <div className={estilos.campo}>
            <label htmlFor={ids.club}>Club</label>
            <select id={ids.club} value={clubId} onChange={(e) => setClubId(e.target.value)}>
              {clubes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
        <Campo
          etiqueta="Nombre"
          placeholder="Senior, Infantil A…"
          required
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          error={errores.nombre}
        />
        <Campo
          etiqueta="Categoría"
          list={ids.categorias}
          placeholder="Elige de la lista o escríbela"
          required
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          error={errores.categoria}
        />
        <datalist id={ids.categorias}>
          {CATEGORIAS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className={estilos.campo}>
          <label htmlFor={ids.temporada}>Temporada</label>
          <select
            id={ids.temporada}
            value={temporada}
            onChange={(e) => setTemporada(e.target.value)}
          >
            {temporadas.map((t) => (
              <option key={t} value={t}>
                {t}
                {t === actual ? ' (actual)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className={estilos.campo}>
          <label htmlFor={ids.anterior}>Plantilla de la temporada anterior</label>
          <select
            id={ids.anterior}
            value={anteriorId}
            onChange={(e) => setAnteriorId(e.target.value)}
          >
            <option value="">Ninguna</option>
            {candidatas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} · {p.temporada}
              </option>
            ))}
          </select>
          <p className={estilos.ayuda}>Para seguir la historia de la plantilla año a año.</p>
        </div>
      </form>
    </HojaInferior>
  )
}
