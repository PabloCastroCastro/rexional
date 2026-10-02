import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { api, datos, erroresPorCampo } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { CLAVE_CLUBES, CLAVE_PLANTILLAS } from '../plantillas/datos'
import estilos from './Configuracion.module.css'

export function NombreClub({ club }: { club: { id: string; nombre: string } }) {
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [nombre, setNombre] = useState(club.nombre)
  const [error, setError] = useState<string>()

  useEffect(() => setNombre(club.nombre), [club.nombre])

  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/clubes/{cid}', {
          params: { path: { cid: club.id } },
          body: { nombre: nombre.trim() },
        }),
      ),
    onSuccess: async () => {
      // El nombre del club aparece en la cabecera, el selector y la lista de clubes
      await Promise.all([
        cliente.invalidateQueries({ queryKey: CLAVE_PLANTILLAS }),
        cliente.invalidateQueries({ queryKey: CLAVE_CLUBES }),
      ])
      avisar({ tipo: 'exito', mensaje: 'Nombre del club guardado' })
    },
    onError: (e) =>
      setError(
        erroresPorCampo(e).nombre ?? (e instanceof Error ? e.message : 'No se ha podido guardar'),
      ),
  })

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return setError('El nombre es obligatorio')
    setError(undefined)
    guardar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={enviar} noValidate>
      <Campo
        etiqueta="Nombre del club"
        required
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        error={error}
      />
      <div className={estilos.acciones}>
        <Boton
          type="submit"
          cargando={guardar.isPending}
          disabled={nombre.trim() === club.nombre}
          icono={<Save aria-hidden size={18} />}
        >
          Guardar
        </Boton>
      </div>
    </form>
  )
}
