import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MailPlus, Send } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, datos, enviar, erroresPorCampo } from '../api/cliente'
import type { components } from '../api/esquema'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { useConfirmacion } from '../componentes/Confirmacion'
import { HojaInferior } from '../componentes/HojaInferior'
import { MensajeCompartible } from '../componentes/MensajeCompartible'
import { Selector } from '../componentes/Selector'
import estilos from './Configuracion.module.css'

// Invitaciones (GH-51): a una plantilla con un rol o como administrador del club. La app no envía
// correos: al invitar se muestra el enlace una sola vez para compartirlo (WhatsApp, por ejemplo).

type Invitacion = components['schemas']['Invitacion']
export type Rol = NonNullable<Invitacion['rol']>

export const ROLES: Record<Rol, string> = {
  admin: 'Admin',
  entrenador: 'Entrenador',
  delegado: 'Delegado',
  jugador: 'Jugador',
}

// A dónde se invita: una plantilla o el club (como administrador)
export type Destino =
  | { tipo: 'plantilla'; id: string; nombre: string }
  | { tipo: 'club'; id: string; nombre: string }

export const claveInvitaciones = (destino: Destino) =>
  ['invitaciones', destino.tipo, destino.id] as const

const fecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'numeric' })

export function useInvitaciones(destino: Destino) {
  return useQuery({
    queryKey: claveInvitaciones(destino),
    queryFn: () =>
      destino.tipo === 'plantilla'
        ? datos(
            api.GET('/api/plantillas/{id}/invitaciones', {
              params: { path: { id: destino.id } },
            }),
          )
        : datos(
            api.GET('/api/clubes/{cid}/invitaciones', { params: { path: { cid: destino.id } } }),
          ),
  })
}

// Las pendientes (y las caducadas, marcadas), con el botón de anularlas
export function InvitacionesPendientes({ destino }: { destino: Destino }) {
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const invitaciones = useInvitaciones(destino)

  const anular = useMutation({
    mutationFn: (iid: string) =>
      destino.tipo === 'plantilla'
        ? enviar(
            api.DELETE('/api/plantillas/{id}/invitaciones/{iid}', {
              params: { path: { id: destino.id, iid } },
            }),
          )
        : enviar(
            api.DELETE('/api/clubes/{cid}/invitaciones/{iid}', {
              params: { path: { cid: destino.id, iid } },
            }),
          ),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: claveInvitaciones(destino) })
      avisar({ tipo: 'exito', mensaje: 'Invitación anulada' })
    },
    onError: (e) =>
      avisar({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'No se ha podido anular' }),
  })

  async function pedirAnulacion(i: Invitacion) {
    const ok = await confirmar({
      titulo: `¿Anular la invitación a ${i.email}?`,
      mensaje: 'El enlace dejará de valer.',
      textoConfirmar: 'Anular',
      peligrosa: true,
    })
    if (ok) anular.mutate(i.id)
  }

  const lista = invitaciones.data ?? []
  if (lista.length === 0) return null
  return (
    <>
      <h3 className={estilos.subtitulo}>Invitaciones pendientes · {lista.length}</h3>
      <ul className={estilos.lista} aria-label="Invitaciones pendientes">
        {lista.map((i) => (
          <li key={i.id}>
            <span className={estilos.fila}>
              <strong>{i.email}</strong>
              <span className={estilos.secundario}>
                {[
                  i.rol && ROLES[i.rol],
                  i.jugador && `Ficha: ${i.jugador}`,
                  i.estado === 'caducada'
                    ? 'Caducada'
                    : `Caduca el ${fecha.format(new Date(i.expira))}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <Boton variante="texto" onClick={() => pedirAnulacion(i)}>
              Anular
            </Boton>
          </li>
        ))}
      </ul>
    </>
  )
}

// Hoja de invitar: el formulario y, al crearla, el enlace para compartir (solo se ve ahora)
export function HojaInvitar({
  destino,
  abierta,
  alCerrar,
  jugadores = [],
}: {
  destino: Destino
  abierta: boolean
  alCerrar: () => void
  // Jugadores sin cuenta, para vincular la invitación con rol jugador
  jugadores?: { jugadorId: string; nombre: string }[]
}) {
  return (
    <HojaInferior
      abierta={abierta}
      alCerrar={alCerrar}
      titulo={destino.tipo === 'club' ? 'Invitar administrador' : 'Invitar'}
    >
      {abierta && <Contenido destino={destino} alCerrar={alCerrar} jugadores={jugadores} />}
    </HojaInferior>
  )
}

function Contenido({
  destino,
  alCerrar,
  jugadores,
}: {
  destino: Destino
  alCerrar: () => void
  jugadores: { jugadorId: string; nombre: string }[]
}) {
  const cliente = useQueryClient()
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState<Rol>('jugador')
  const [jugadorId, setJugadorId] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [enlace, setEnlace] = useState<string | null>(null)

  const invitar = useMutation({
    mutationFn: () =>
      destino.tipo === 'plantilla'
        ? datos(
            api.POST('/api/plantillas/{id}/invitaciones', {
              params: { path: { id: destino.id } },
              body: {
                email: email.trim(),
                rol,
                jugadorId: rol === 'jugador' && jugadorId ? jugadorId : null,
              },
            }),
          )
        : datos(
            api.POST('/api/clubes/{cid}/invitaciones', {
              params: { path: { cid: destino.id } },
              body: { email: email.trim() },
            }),
          ),
    onSuccess: async (creada) => {
      await cliente.invalidateQueries({ queryKey: claveInvitaciones(destino) })
      setEnlace(creada.enlace)
    },
    onError: (e) => {
      const porCampo = erroresPorCampo(e)
      setErrores(
        Object.keys(porCampo).length > 0
          ? porCampo
          : { general: e instanceof Error ? e.message : 'No se ha podido invitar' },
      )
    },
  })

  function enviarFormulario(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      setErrores({ email: 'Escribe su email' })
      return
    }
    setErrores({})
    invitar.mutate()
  }

  if (enlace) {
    const como =
      destino.tipo === 'club'
        ? `administrador de ${destino.nombre}`
        : `${ROLES[rol].toLowerCase()} en ${destino.nombre}`
    const texto = `Te invito a Vestuario como ${como}. Entra con este enlace (vale 7 días y es para ${email.trim().toLowerCase()}):\n${enlace}`
    return (
      <div className={estilos.formulario}>
        <p className={estilos.informacion} role="status">
          Comparte el enlace ahora: solo se muestra esta vez. Si lo pierdes, invita de nuevo.
        </p>
        <MensajeCompartible
          texto={texto}
          whatsapp={`https://wa.me/?text=${encodeURIComponent(texto)}`}
        />
        <div className={estilos.acciones}>
          <Boton variante="secundario" onClick={alCerrar}>
            Hecho
          </Boton>
        </div>
      </div>
    )
  }

  return (
    <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
      {errores.general && (
        <p className={estilos.error} role="alert">
          {errores.general}
        </p>
      )}
      <Campo
        etiqueta="Email"
        type="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errores.email}
        ayuda="Tendrá que entrar o crear su cuenta con este email."
      />
      {destino.tipo === 'plantilla' && (
        <Selector
          etiqueta="Rol"
          value={rol}
          onChange={(e) => setRol(e.target.value as Rol)}
          error={errores.rol}
        >
          {Object.entries(ROLES).map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </Selector>
      )}
      {destino.tipo === 'plantilla' && rol === 'jugador' && (
        <Selector
          etiqueta="Su ficha de jugador"
          value={jugadorId}
          onChange={(e) => setJugadorId(e.target.value)}
          error={errores.jugadorId}
        >
          <option value="">Ninguna</option>
          {jugadores.map((j) => (
            <option key={j.jugadorId} value={j.jugadorId}>
              {j.nombre}
            </option>
          ))}
        </Selector>
      )}
      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={invitar.isPending} icono={<Send aria-hidden size={18} />}>
          Invitar
        </Boton>
      </div>
    </form>
  )
}

export function BotonInvitar({ texto, onClick }: { texto: string; onClick: () => void }) {
  return (
    <div className={estilos.acciones}>
      <Boton variante="secundario" icono={<MailPlus aria-hidden size={18} />} onClick={onClick}>
        {texto}
      </Boton>
    </div>
  )
}
