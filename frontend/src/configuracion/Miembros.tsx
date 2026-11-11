import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, UserMinus } from 'lucide-react'
import { useState } from 'react'
import { api, datos, enviar } from '../api/cliente'
import type { components } from '../api/esquema'
import { useSesion } from '../auth/sesion'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { HojaInferior } from '../componentes/HojaInferior'
import { CLAVE_PLANTILLAS } from '../plantillas/datos'
import estilos from './Configuracion.module.css'
import {
  BotonInvitar,
  type Destino,
  HojaInvitar,
  InvitacionesPendientes,
  ROLES,
  type Rol,
} from './Invitaciones'

// Miembros de la plantilla (GH-51), solo para el admin: quién tiene acceso y con qué rol, las
// invitaciones pendientes e invitar. Los administradores del club salen primero y no se tocan aquí.

type Miembro = components['schemas']['MiembroPlantilla']

const claveMiembros = (plantillaId: string) => ['miembros', plantillaId] as const

export function Miembros({ plantilla }: { plantilla: { id: string; nombre: string } }) {
  const [invitando, setInvitando] = useState(false)
  const [elegido, setElegido] = useState<Miembro | null>(null)
  const miembros = useQuery({
    queryKey: claveMiembros(plantilla.id),
    queryFn: () =>
      datos(api.GET('/api/plantillas/{id}/miembros', { params: { path: { id: plantilla.id } } })),
  })
  const destino: Destino = { tipo: 'plantilla', id: plantilla.id, nombre: plantilla.nombre }

  if (miembros.isPending) return <Cargando />
  if (miembros.isError) {
    return (
      <p className={estilos.error} role="alert">
        {miembros.error.message}
      </p>
    )
  }

  return (
    <>
      <ul className={estilos.lista} aria-label="Miembros">
        {miembros.data.miembros.map((m) => {
          const texto = (
            <span className={estilos.fila}>
              <strong>{m.nombre}</strong>
              <span className={estilos.secundario}>
                {[
                  m.heredado ? 'Administrador del club' : ROLES[m.rol],
                  m.jugador && `Ficha: ${m.jugador}`,
                  m.email,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          )
          return (
            <li key={m.usuarioId}>
              {m.heredado ? (
                texto
              ) : (
                <button
                  type="button"
                  className={estilos.filaBoton}
                  onClick={() => setElegido(m)}
                  aria-label={`Cambiar el rol de ${m.nombre}`}
                >
                  {texto}
                  <ChevronRight aria-hidden size={18} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <InvitacionesPendientes destino={destino} />
      <BotonInvitar texto="Invitar" onClick={() => setInvitando(true)} />
      <HojaInvitar
        destino={destino}
        abierta={invitando}
        alCerrar={() => setInvitando(false)}
        jugadores={miembros.data.jugadoresSinCuenta}
      />
      <HojaMiembro plantillaId={plantilla.id} miembro={elegido} alCerrar={() => setElegido(null)} />
    </>
  )
}

function HojaMiembro({
  plantillaId,
  miembro,
  alCerrar,
}: {
  plantillaId: string
  miembro: Miembro | null
  alCerrar: () => void
}) {
  const cliente = useQueryClient()
  const sesion = useSesion()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const yoMismo = miembro?.usuarioId === sesion.data?.user.id

  // Si cambia uno mismo, cambian sus permisos: se refrescan las plantillas
  const refrescar = async () => {
    await cliente.invalidateQueries({ queryKey: claveMiembros(plantillaId) })
    if (yoMismo) await cliente.invalidateQueries({ queryKey: CLAVE_PLANTILLAS })
  }

  const cambiar = useMutation({
    mutationFn: (rol: Rol) =>
      datos(
        api.PATCH('/api/plantillas/{id}/miembros/{uid}', {
          params: { path: { id: plantillaId, uid: miembro?.usuarioId ?? '' } },
          body: { rol },
        }),
      ),
    onSuccess: async ({ rol }) => {
      await refrescar()
      avisar({ tipo: 'exito', mensaje: `${miembro?.nombre} ahora es ${ROLES[rol].toLowerCase()}` })
      alCerrar()
    },
    onError: (e) =>
      avisar({
        tipo: 'error',
        mensaje: e instanceof Error ? e.message : 'No se ha podido cambiar',
      }),
  })

  const retirar = useMutation({
    mutationFn: () =>
      enviar(
        api.DELETE('/api/plantillas/{id}/miembros/{uid}', {
          params: { path: { id: plantillaId, uid: miembro?.usuarioId ?? '' } },
        }),
      ),
    onSuccess: async () => {
      await refrescar()
      avisar({ tipo: 'exito', mensaje: `${miembro?.nombre} ya no tiene acceso` })
      alCerrar()
    },
    onError: (e) =>
      avisar({
        tipo: 'error',
        mensaje: e instanceof Error ? e.message : 'No se ha podido retirar',
      }),
  })

  async function elegirRol(rol: Rol) {
    if (!miembro || rol === miembro.rol) return
    if (yoMismo && miembro.rol === 'admin') {
      const ok = await confirmar({
        titulo: '¿Dejar de ser admin?',
        mensaje: 'Ya no podrás gestionar los miembros de esta plantilla.',
        textoConfirmar: `Pasar a ${ROLES[rol].toLowerCase()}`,
        peligrosa: true,
      })
      if (!ok) return
    }
    cambiar.mutate(rol)
  }

  async function pedirRetirada() {
    if (!miembro) return
    const ok = await confirmar({
      titulo: yoMismo ? '¿Salir de la plantilla?' : `¿Retirar el acceso a ${miembro.nombre}?`,
      mensaje: yoMismo
        ? 'Dejarás de ver esta plantilla.'
        : 'Dejará de ver la plantilla. Si es jugador, su ficha sigue vinculada a su cuenta.',
      textoConfirmar: yoMismo ? 'Salir' : 'Retirar acceso',
      peligrosa: true,
    })
    if (ok) retirar.mutate()
  }

  return (
    <HojaInferior
      abierta={miembro !== null}
      alCerrar={alCerrar}
      titulo={miembro ? miembro.nombre : ''}
    >
      {miembro && (
        <div className={estilos.formulario}>
          <fieldset className={estilos.roles}>
            <legend>Rol en la plantilla</legend>
            {(Object.keys(ROLES) as Rol[]).map((rol) => (
              <label key={rol}>
                <input
                  type="radio"
                  name="rol"
                  value={rol}
                  checked={miembro.rol === rol}
                  disabled={cambiar.isPending}
                  onChange={() => elegirRol(rol)}
                />
                {ROLES[rol]}
              </label>
            ))}
          </fieldset>
          <div className={estilos.acciones}>
            <Boton
              variante="peligro"
              icono={<UserMinus aria-hidden size={18} />}
              cargando={retirar.isPending}
              onClick={pedirRetirada}
            >
              {yoMismo ? 'Salir de la plantilla' : 'Retirar acceso'}
            </Boton>
          </div>
        </div>
      )}
    </HojaInferior>
  )
}
