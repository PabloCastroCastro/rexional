import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, datos, erroresPorCampo } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { HojaInferior } from '../componentes/HojaInferior'
import { Selector } from '../componentes/Selector'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CATEGORIAS, type Categoria, CLAVE_EJERCICIOS, type Ejercicio } from './datos'
import estilos from './Ejercicios.module.css'

// Crear o editar los datos de un ejercicio, en hoja inferior. Las fotos y los vídeos se añaden en
// su ficha.
export function FormularioEjercicio({
  abierta,
  ejercicio,
  alCerrar,
  alGuardar,
}: {
  abierta: boolean
  // Sin ejercicio, se crea uno nuevo
  ejercicio?: Ejercicio
  alCerrar: () => void
  alGuardar?: (ejercicio: Ejercicio) => void
}) {
  return (
    <HojaInferior
      abierta={abierta}
      alCerrar={alCerrar}
      titulo={ejercicio ? 'Editar ejercicio' : 'Nuevo ejercicio'}
    >
      {abierta && <Contenido ejercicio={ejercicio} alCerrar={alCerrar} alGuardar={alGuardar} />}
    </HojaInferior>
  )
}

function Contenido({
  ejercicio,
  alCerrar,
  alGuardar,
}: {
  ejercicio?: Ejercicio
  alCerrar: () => void
  alGuardar?: (ejercicio: Ejercicio) => void
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [nombre, setNombre] = useState(ejercicio?.nombre ?? '')
  const [categoria, setCategoria] = useState<Categoria | ''>(ejercicio?.categoria ?? '')
  const [duracion, setDuracion] = useState(
    ejercicio?.duracionMin ? String(ejercicio.duracionMin) : '',
  )
  const [jugadores, setJugadores] = useState(ejercicio?.jugadores ?? '')
  const [material, setMaterial] = useState(ejercicio?.material ?? '')
  const [descripcion, setDescripcion] = useState(ejercicio?.descripcion ?? '')
  const [etiquetas, setEtiquetas] = useState(ejercicio?.etiquetas.join(', ') ?? '')
  const [errores, setErrores] = useState<Record<string, string>>({})

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = {
        nombre: nombre.trim(),
        categoria: categoria || null,
        duracionMin: duracion ? Number(duracion) : null,
        jugadores: jugadores.trim() || null,
        material: material.trim() || null,
        descripcion: descripcion.trim() || null,
        etiquetas: etiquetas
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }
      const club = { cid: plantilla.clubId }
      return ejercicio
        ? datos(
            api.PATCH('/api/clubes/{cid}/ejercicios/{eid}', {
              params: { path: { ...club, eid: ejercicio.id } },
              body: cuerpo,
            }),
          )
        : datos(api.POST('/api/clubes/{cid}/ejercicios', { params: { path: club }, body: cuerpo }))
    },
    onSuccess: async (guardado) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_EJERCICIOS })
      avisar({
        tipo: 'exito',
        mensaje: ejercicio ? 'Ejercicio guardado' : `«${guardado.nombre}» creado`,
      })
      alGuardar?.(guardado)
      alCerrar()
    },
    onError: (error) => {
      const porCampo = erroresPorCampo(error)
      setErrores(
        Object.keys(porCampo).length > 0
          ? porCampo
          : { general: error instanceof Error ? error.message : 'No se ha podido guardar' },
      )
    },
  })

  function enviar(e: FormEvent) {
    e.preventDefault()
    setErrores({})
    if (!nombre.trim()) return setErrores({ nombre: 'Escribe el nombre del ejercicio' })
    guardar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={enviar} noValidate>
      <Campo
        etiqueta="Nombre"
        required
        value={nombre}
        maxLength={120}
        onChange={(e) => setNombre(e.target.value)}
        error={errores.nombre}
      />
      <div className={estilos.columnas}>
        <Selector
          etiqueta="Categoría"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value as Categoria | '')}
        >
          <option value="">Sin categoría</option>
          {Object.entries(CATEGORIAS).map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </Selector>
        <Campo
          etiqueta="Duración (min)"
          type="number"
          inputMode="numeric"
          min={1}
          max={240}
          value={duracion}
          onChange={(e) => setDuracion(e.target.value)}
          error={errores.duracionMin}
        />
      </div>
      <div className={estilos.columnas}>
        <Campo
          etiqueta="Jugadores"
          placeholder="8-12"
          value={jugadores}
          maxLength={60}
          onChange={(e) => setJugadores(e.target.value)}
        />
        <Campo
          etiqueta="Material"
          placeholder="Conos, petos…"
          value={material}
          maxLength={500}
          onChange={(e) => setMaterial(e.target.value)}
        />
      </div>
      <label className={estilos.areaTexto}>
        <span>Descripción</span>
        <textarea
          rows={5}
          maxLength={4000}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Cómo se organiza, reglas, variantes…"
        />
      </label>
      <Campo
        etiqueta="Etiquetas"
        ayuda="Separadas por comas: presión, salida de balón…"
        value={etiquetas}
        onChange={(e) => setEtiquetas(e.target.value)}
        error={errores.etiquetas}
      />
      {errores.general && (
        <p className={estilos.error} role="alert">
          {errores.general}
        </p>
      )}
      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={guardar.isPending} icono={<Save aria-hidden size={18} />}>
          {ejercicio ? 'Guardar' : 'Crear ejercicio'}
        </Boton>
      </div>
    </form>
  )
}
