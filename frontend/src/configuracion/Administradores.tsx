import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserMinus } from 'lucide-react'
import { useState } from 'react'
import { api, datos, enviar } from '../api/cliente'
import { useSesion } from '../auth/sesion'
import { useAvisos } from '../componentes/Avisos'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { CLAVE_CLUBES, CLAVE_PLANTILLAS } from '../plantillas/datos'
import estilos from './Configuracion.module.css'
import { BotonInvitar, type Destino, HojaInvitar, InvitacionesPendientes } from './Invitaciones'

const claveAdmins = (clubId: string) => ['admins', clubId] as const

// Administradores del club: ver, invitar (GH-51) y retirar; un club nunca se queda sin ninguno
export function Administradores({ club }: { club: { id: string; nombre: string } }) {
  const cliente = useQueryClient()
  const sesion = useSesion()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const [invitando, setInvitando] = useState(false)
  const destino: Destino = { tipo: 'club', id: club.id, nombre: club.nombre }

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
          Un club no puede quedarse sin administradores: invita a otro antes de retirarte.
        </p>
      )}
      <InvitacionesPendientes destino={destino} />
      <BotonInvitar texto="Invitar administrador" onClick={() => setInvitando(true)} />
      <HojaInvitar destino={destino} abierta={invitando} alCerrar={() => setInvitando(false)} />
    </>
  )
}
