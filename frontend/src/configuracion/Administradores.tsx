import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserMinus, UserPlus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, datos, ErrorApi, enviar, erroresPorCampo } from '../api/cliente'
import { useSesion } from '../auth/sesion'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { HojaInferior } from '../componentes/HojaInferior'
import { CLAVE_CLUBES, CLAVE_PLANTILLAS } from '../plantillas/datos'
import estilos from './Configuracion.module.css'

const claveAdmins = (clubId: string) => ['admins', clubId] as const

// Administradores del club: ver, añadir por email (usuarios que ya existen) y retirar
export function Administradores({ club }: { club: { id: string; nombre: string } }) {
  const cliente = useQueryClient()
  const sesion = useSesion()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const [anadiendo, setAnadiendo] = useState(false)

  const admins = useQuery({
    queryKey: claveAdmins(club.id),
    queryFn: () =>
      datos(api.GET('/api/clubes/{cid}/admins', { params: { path: { cid: club.id } } })),
  })

  const retirar = useMutation({
    mutationFn: (usuarioId: string) =>
      enviar(
        api.DELETE('/api/clubes/{cid}/admins/{uid}', {
          params: { path: { cid: club.id, uid: usuarioId } },
        }),
      ),
    onSuccess: async (_, usuarioId) => {
      await cliente.invalidateQueries({ queryKey: claveAdmins(club.id) })
      // Retirarse a uno mismo cambia sus permisos en todo el club
      if (usuarioId === sesion.data?.user.id) {
        await Promise.all([
          cliente.invalidateQueries({ queryKey: CLAVE_PLANTILLAS }),
          cliente.invalidateQueries({ queryKey: CLAVE_CLUBES }),
        ])
      }
      avisar({ tipo: 'exito', mensaje: 'Administrador retirado' })
    },
    onError: (e) =>
      avisar({
        tipo: 'error',
        mensaje: e instanceof Error ? e.message : 'No se ha podido retirar',
      }),
  })

  async function pedirRetirada(admin: { usuarioId: string; nombre: string }) {
    const yoMismo = admin.usuarioId === sesion.data?.user.id
    const ok = await confirmar({
      titulo: yoMismo ? '¿Dejar de ser administrador?' : `¿Retirar a ${admin.nombre}?`,
      mensaje: yoMismo
        ? `Perderás el acceso de administrador a ${club.nombre} y a todas sus plantillas.`
        : `Dejará de administrar ${club.nombre}. Conservará los roles que tenga en sus plantillas.`,
      textoConfirmar: yoMismo ? 'Dejar de ser administrador' : 'Retirar',
      peligrosa: true,
    })
    if (ok) retirar.mutate(admin.usuarioId)
  }

  if (admins.isPending) return <Cargando />
  const lista = admins.data ?? []

  return (
    <>
      <ul className={estilos.lista}>
        {lista.map((admin) => (
          <li key={admin.usuarioId}>
            <span className={estilos.fila}>
              <strong>
                {admin.nombre}
                {admin.usuarioId === sesion.data?.user.id && ' (tú)'}
              </strong>
              <span className={estilos.secundario}>{admin.email}</span>
            </span>
            <button
              type="button"
              className={`${estilos.iconoAccion} ${estilos.peligro}`}
              onClick={() => pedirRetirada(admin)}
              aria-label={`Retirar a ${admin.nombre}`}
            >
              <UserMinus aria-hidden size={18} />
            </button>
          </li>
        ))}
      </ul>
      {lista.length === 1 && (
        <p className={estilos.descripcion}>
          Un club no puede quedarse sin administradores: añade otro antes de retirarte.
        </p>
      )}
      <div className={estilos.acciones}>
        <Boton
          variante="secundario"
          icono={<UserPlus aria-hidden size={18} />}
          onClick={() => setAnadiendo(true)}
        >
          Añadir administrador
        </Boton>
      </div>
      <AnadirAdministrador
        clubId={club.id}
        abierta={anadiendo}
        alCerrar={() => setAnadiendo(false)}
      />
    </>
  )
}

function AnadirAdministrador({
  clubId,
  abierta,
  alCerrar,
}: {
  clubId: string
  abierta: boolean
  alCerrar: () => void
}) {
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string>()

  const cerrar = () => {
    setEmail('')
    setError(undefined)
    alCerrar()
  }

  const anadir = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/clubes/{cid}/admins', {
          params: { path: { cid: clubId } },
          body: { email: email.trim() },
        }),
      ),
    onSuccess: async (admin) => {
      await cliente.invalidateQueries({ queryKey: claveAdmins(clubId) })
      avisar({ tipo: 'exito', mensaje: `${admin.nombre} ya es administrador del club` })
      cerrar()
    },
    onError: (e) =>
      setError(
        erroresPorCampo(e).email ??
          (e instanceof ErrorApi ? e.message : 'No se ha podido añadir el administrador'),
      ),
  })

  function enviarFormulario(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return setError('Escribe el email del usuario')
    setError(undefined)
    anadir.mutate()
  }

  return (
    <HojaInferior abierta={abierta} alCerrar={cerrar} titulo="Añadir administrador">
      <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
        <Campo
          etiqueta="Email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          ayuda="Tiene que ser un usuario que ya exista. Las invitaciones por email llegarán más adelante."
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error}
        />
        <div className={estilos.acciones}>
          <Boton variante="secundario" onClick={cerrar}>
            Cancelar
          </Boton>
          <Boton
            type="submit"
            cargando={anadir.isPending}
            icono={<UserPlus aria-hidden size={18} />}
          >
            Añadir
          </Boton>
        </div>
      </form>
    </HojaInferior>
  )
}
