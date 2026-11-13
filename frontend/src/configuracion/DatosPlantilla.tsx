import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { api, datos, ErrorApi, erroresPorCampo } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { CATEGORIAS, CLAVE_PLANTILLAS } from '../plantillas/datos'
import estilos from './Configuracion.module.css'

type PlantillaEditable = {
  id: string
  nombre: string
  categoria: string
  multasActivas: boolean
  horasLimiteRespuesta: number
  amarillasCiclo: number
  partidosRoja: number
  partidosDobleAmarilla: number
}

// Reglas de las sanciones (GH-231): números enteros de 0 a 20
const REGLAS = [
  { campo: 'amarillasCiclo', etiqueta: 'Amarillas por ciclo' },
  { campo: 'partidosRoja', etiqueta: 'Partidos por roja directa' },
  { campo: 'partidosDobleAmarilla', etiqueta: 'Partidos por doble amarilla' },
] as const

type Regla = (typeof REGLAS)[number]['campo']

const reglasDe = (p: PlantillaEditable): Record<Regla, string> => ({
  amarillasCiclo: String(p.amarillasCiclo),
  partidosRoja: String(p.partidosRoja),
  partidosDobleAmarilla: String(p.partidosDobleAmarilla),
})

const reglaValida = (texto: string) => {
  const n = Number(texto)
  return texto.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 20
}

// Nombre, categoría, multas y hora límite para responder a los entrenos (GH-204) de una plantilla. Se usa para la plantilla activa y para editar cualquier
// plantilla del club desde la lista.
export function DatosPlantilla({
  plantilla,
  alGuardar,
  alCancelar,
}: {
  plantilla: PlantillaEditable
  alGuardar?: () => void
  alCancelar?: () => void
}) {
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [nombre, setNombre] = useState(plantilla.nombre)
  const [categoria, setCategoria] = useState(plantilla.categoria)
  const [multasActivas, setMultasActivas] = useState(plantilla.multasActivas)
  const [horas, setHoras] = useState(String(plantilla.horasLimiteRespuesta))
  const [reglas, setReglas] = useState(() => reglasDe(plantilla))
  const [errores, setErrores] = useState<Record<string, string>>({})
  const idCategorias = useId()

  // Si la plantilla cambia (otra plantilla o datos refrescados), el formulario la sigue
  useEffect(() => {
    setNombre(plantilla.nombre)
    setCategoria(plantilla.categoria)
    setMultasActivas(plantilla.multasActivas)
    setHoras(String(plantilla.horasLimiteRespuesta))
    setReglas({
      amarillasCiclo: String(plantilla.amarillasCiclo),
      partidosRoja: String(plantilla.partidosRoja),
      partidosDobleAmarilla: String(plantilla.partidosDobleAmarilla),
    })
    setErrores({})
  }, [
    plantilla.nombre,
    plantilla.categoria,
    plantilla.multasActivas,
    plantilla.horasLimiteRespuesta,
    plantilla.amarillasCiclo,
    plantilla.partidosRoja,
    plantilla.partidosDobleAmarilla,
  ])

  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/plantillas/{id}', {
          params: { path: { id: plantilla.id } },
          body: {
            nombre: nombre.trim(),
            categoria: categoria.trim(),
            multasActivas,
            horasLimiteRespuesta: Number(horas),
            amarillasCiclo: Number(reglas.amarillasCiclo),
            partidosRoja: Number(reglas.partidosRoja),
            partidosDobleAmarilla: Number(reglas.partidosDobleAmarilla),
          },
        }),
      ),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: CLAVE_PLANTILLAS })
      avisar({ tipo: 'exito', mensaje: 'Plantilla guardada' })
      alGuardar?.()
    },
    onError: (error) => {
      const porCampo = erroresPorCampo(error)
      if (Object.keys(porCampo).length > 0) setErrores(porCampo)
      else if (error instanceof ErrorApi && error.codigo === 'plantilla_duplicada') {
        setErrores({ nombre: error.message })
      } else {
        setErrores({ general: error instanceof Error ? error.message : 'No se ha podido guardar' })
      }
    },
  })

  const hayCambios =
    nombre.trim() !== plantilla.nombre ||
    categoria.trim() !== plantilla.categoria ||
    multasActivas !== plantilla.multasActivas ||
    Number(horas) !== plantilla.horasLimiteRespuesta ||
    REGLAS.some(({ campo }) => Number(reglas[campo]) !== plantilla[campo])

  function enviar(e: FormEvent) {
    e.preventDefault()
    const faltan: Record<string, string> = {}
    if (!nombre.trim()) faltan.nombre = 'El nombre es obligatorio'
    if (!categoria.trim()) faltan.categoria = 'La categoría es obligatoria'
    const n = Number(horas)
    if (horas.trim() === '' || !Number.isInteger(n) || n < 0 || n > 72) {
      faltan.horasLimiteRespuesta = 'La hora límite va de 0 a 72 horas'
    }
    for (const { campo } of REGLAS) {
      if (!reglaValida(reglas[campo])) faltan[campo] = 'Un número entero de 0 a 20'
    }
    setErrores(faltan)
    if (Object.keys(faltan).length === 0) guardar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={enviar} noValidate>
      {errores.general && (
        <p className={estilos.aviso} role="alert">
          {errores.general}
        </p>
      )}
      <Campo
        etiqueta="Nombre"
        required
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        error={errores.nombre}
      />
      <Campo
        etiqueta="Categoría"
        list={idCategorias}
        required
        value={categoria}
        onChange={(e) => setCategoria(e.target.value)}
        error={errores.categoria}
      />
      <datalist id={idCategorias}>
        {CATEGORIAS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <label className={estilos.interruptor}>
        <input
          type="checkbox"
          checked={multasActivas}
          onChange={(e) => setMultasActivas(e.target.checked)}
        />
        <span>
          Multas en esta plantilla
          <span className={estilos.descripcion}>
            Desactívalas si no aplican (p. ej. en alevines): se ocultan sin borrar nada.
          </span>
        </span>
      </label>
      <Campo
        etiqueta="Hora límite para responder a los entrenos"
        type="number"
        inputMode="numeric"
        min={0}
        max={72}
        step={1}
        value={horas}
        onChange={(e) => setHoras(e.target.value)}
        error={errores.horasLimiteRespuesta}
        ayuda="Horas antes del inicio hasta las que los jugadores pueden decir si van. Con 0, hasta la hora del entreno."
      />
      <fieldset className={estilos.reglas}>
        <legend>Sanciones</legend>
        <p className={estilos.descripcion}>
          Se calculan con las tarjetas de los partidos. La sanción por ciclo es de un partido; con 0
          amarillas, no hay ciclo.
        </p>
        <div className={estilos.reglasCampos}>
          {REGLAS.map(({ campo, etiqueta }) => (
            <Campo
              key={campo}
              etiqueta={etiqueta}
              type="number"
              inputMode="numeric"
              min={0}
              max={20}
              step={1}
              value={reglas[campo]}
              onChange={(e) => setReglas({ ...reglas, [campo]: e.target.value })}
              error={errores[campo]}
            />
          ))}
        </div>
      </fieldset>
      <div className={estilos.acciones}>
        {alCancelar && (
          <Boton variante="secundario" onClick={alCancelar}>
            Cancelar
          </Boton>
        )}
        <Boton
          type="submit"
          cargando={guardar.isPending}
          disabled={!hayCambios}
          icono={<Save aria-hidden size={18} />}
        >
          Guardar
        </Boton>
      </div>
    </form>
  )
}
