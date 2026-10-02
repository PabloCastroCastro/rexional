import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { api, datos, ErrorApi, erroresPorCampo } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { CATEGORIAS, CLAVE_PLANTILLAS } from '../plantillas/datos'
import estilos from './Configuracion.module.css'

type PlantillaEditable = { id: string; nombre: string; categoria: string }

// Nombre y categoría de una plantilla. Se usa para la plantilla activa y para editar cualquier
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
  const [errores, setErrores] = useState<Record<string, string>>({})
  const idCategorias = useId()

  // Si la plantilla cambia (otra plantilla o datos refrescados), el formulario la sigue
  useEffect(() => {
    setNombre(plantilla.nombre)
    setCategoria(plantilla.categoria)
    setErrores({})
  }, [plantilla.nombre, plantilla.categoria])

  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/plantillas/{id}', {
          params: { path: { id: plantilla.id } },
          body: { nombre: nombre.trim(), categoria: categoria.trim() },
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

  const hayCambios = nombre.trim() !== plantilla.nombre || categoria.trim() !== plantilla.categoria

  function enviar(e: FormEvent) {
    e.preventDefault()
    const faltan: Record<string, string> = {}
    if (!nombre.trim()) faltan.nombre = 'El nombre es obligatorio'
    if (!categoria.trim()) faltan.categoria = 'La categoría es obligatoria'
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
