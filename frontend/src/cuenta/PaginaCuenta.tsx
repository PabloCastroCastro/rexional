import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, LogOut, Monitor, Smartphone, Tablet } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import { api, datos, ErrorApi, enviar } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import estilos from '../configuracion/Configuracion.module.css'
import { Seccion } from '../configuracion/Seccion'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'

// Cuenta del usuario (GH-177): sus sesiones abiertas, para cerrar las de un móvil perdido, y el
// cambio de contraseña, que cierra las demás sesiones
export function PaginaCuenta() {
  const plantilla = usePlantillaActiva()
  return (
    <div className={estilos.pagina}>
      <Link to={`/plantillas/${plantilla.id}/mas`} className={estilos.volver}>
        <ChevronLeft aria-hidden size={20} />
        Más
      </Link>
      <h1>Cuenta</h1>
      <Seccion
        titulo="Sesiones abiertas"
        descripcion="Dispositivos en los que has entrado. Si no reconoces alguno, ciérralo y cambia la contraseña."
      >
        <Sesiones />
      </Seccion>
      <Seccion
        titulo="Contraseña"
        descripcion="Al cambiarla se cierra la sesión en los demás dispositivos."
      >
        <CambiarContrasena />
      </Seccion>
    </div>
  )
}

export const CLAVE_SESIONES = ['cuenta', 'sesiones'] as const

type Sesion = {
  id: string
  actual: boolean
  navegador: string | null
  sistema: string | null
  ip: string | null
  ultimoUso: string
}

const nombreDispositivo = (s: Sesion) =>
  s.navegador && s.sistema
    ? `${s.navegador} en ${s.sistema}`
    : (s.navegador ?? s.sistema ?? 'Dispositivo desconocido')

function IconoDispositivo({ sistema }: { sistema: string | null }) {
  if (sistema === 'Android' || sistema === 'iPhone') return <Smartphone aria-hidden size={20} />
  if (sistema === 'iPad') return <Tablet aria-hidden size={20} />
  return <Monitor aria-hidden size={20} />
}

const formatoUso = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Madrid',
})

function Sesiones() {
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const sesiones = useQuery({
    queryKey: CLAVE_SESIONES,
    queryFn: () => datos(api.GET('/api/cuenta/sesiones')),
  })

  const alFallar = (e: Error) =>
    avisar({ tipo: 'error', mensaje: e.message || 'No se ha podido cerrar la sesión' })

  const cerrarUna = useMutation({
    mutationFn: (id: string) =>
      enviar(api.DELETE('/api/cuenta/sesiones/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: CLAVE_SESIONES })
      avisar({ tipo: 'exito', mensaje: 'Sesión cerrada en ese dispositivo' })
    },
    onError: alFallar,
  })

  const cerrarOtras = useMutation({
    mutationFn: () => datos(api.POST('/api/cuenta/sesiones/cerrar-otras')),
    onSuccess: async ({ cerradas }) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_SESIONES })
      avisar({
        tipo: 'exito',
        mensaje:
          cerradas === 1
            ? 'Sesión cerrada en 1 dispositivo'
            : `Sesión cerrada en ${cerradas} dispositivos`,
      })
    },
    onError: alFallar,
  })

  async function pedirCierre(sesion: Sesion) {
    const ok = await confirmar({
      titulo: `¿Cerrar la sesión en ${nombreDispositivo(sesion)}?`,
      mensaje: 'Ese dispositivo tendrá que volver a iniciar sesión.',
      textoConfirmar: 'Cerrar sesión',
      peligrosa: true,
    })
    if (ok) cerrarUna.mutate(sesion.id)
  }

  async function pedirCierreOtras(cuantas: number) {
    const ok = await confirmar({
      titulo: '¿Cerrar la sesión en los demás dispositivos?',
      mensaje:
        cuantas === 1
          ? 'El otro dispositivo tendrá que volver a iniciar sesión. Este no.'
          : `Los otros ${cuantas} dispositivos tendrán que volver a iniciar sesión. Este no.`,
      textoConfirmar: 'Cerrar las demás',
      peligrosa: true,
    })
    if (ok) cerrarOtras.mutate()
  }

  if (sesiones.isPending) return <Cargando />
  if (sesiones.isError) {
    return (
      <div className={estilos.acciones}>
        <p className={estilos.descripcion} role="alert">
          No se han podido cargar las sesiones.
        </p>
        <Boton variante="secundario" onClick={() => sesiones.refetch()}>
          Reintentar
        </Boton>
      </div>
    )
  }

  const lista = sesiones.data
  const otras = lista.filter((s) => !s.actual)
  return (
    <>
      <ul className={estilos.lista}>
        {lista.map((s) => (
          <li key={s.id}>
            <IconoDispositivo sistema={s.sistema} />
            <span className={estilos.fila}>
              <strong>{nombreDispositivo(s)}</strong>
              <span className={estilos.secundario}>
                {s.actual
                  ? 'Este dispositivo'
                  : `Último uso: ${formatoUso.format(new Date(s.ultimoUso))}`}
              </span>
              {s.ip && <span className={estilos.secundario}>IP {s.ip}</span>}
            </span>
            {!s.actual && (
              <button
                type="button"
                className={`${estilos.iconoAccion} ${estilos.peligro}`}
                onClick={() => pedirCierre(s)}
                aria-label={`Cerrar la sesión en ${nombreDispositivo(s)}`}
                disabled={cerrarUna.isPending}
              >
                <LogOut aria-hidden size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {otras.length > 0 ? (
        <div className={estilos.acciones}>
          <Boton
            variante="secundario"
            icono={<LogOut aria-hidden size={18} />}
            cargando={cerrarOtras.isPending}
            onClick={() => pedirCierreOtras(otras.length)}
          >
            Cerrar las demás sesiones
          </Boton>
        </div>
      ) : (
        <p className={estilos.descripcion}>
          No tienes la sesión abierta en ningún otro dispositivo.
        </p>
      )}
    </>
  )
}

const MINIMO = 10

function CambiarContrasena() {
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [errores, setErrores] = useState<{ actual?: string; nueva?: string; repetida?: string }>({})

  const cambiar = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: actual,
          newPassword: nueva,
          revokeOtherSessions: true,
        }),
      })
      if (res.ok) return
      const cuerpo = (await res.json().catch(() => null)) as {
        code?: string
        error?: { mensaje?: string }
      } | null
      throw new ErrorApi(res.status, cuerpo?.code ?? 'error', cuerpo?.error?.mensaje ?? '')
    },
    onSuccess: async () => {
      setActual('')
      setNueva('')
      setRepetida('')
      setErrores({})
      await cliente.invalidateQueries({ queryKey: CLAVE_SESIONES })
      avisar({
        tipo: 'exito',
        mensaje: 'Contraseña cambiada. Se ha cerrado la sesión en los demás dispositivos.',
      })
    },
    onError: (e) => {
      const codigo = e instanceof ErrorApi ? e.codigo : 'error'
      if (codigo === 'INVALID_PASSWORD') {
        setErrores({ actual: 'La contraseña actual no es correcta' })
      } else if (codigo === 'PASSWORD_TOO_SHORT') {
        setErrores({ nueva: `Tiene que tener al menos ${MINIMO} caracteres` })
      } else {
        avisar({
          tipo: 'error',
          mensaje: e.message || 'No se ha podido cambiar la contraseña. Inténtalo de nuevo.',
        })
      }
    },
  })

  function enviarFormulario(evento: FormEvent) {
    evento.preventDefault()
    const nuevos: typeof errores = {}
    if (!actual) nuevos.actual = 'Escribe tu contraseña actual'
    if (nueva.length < MINIMO) nuevos.nueva = `Tiene que tener al menos ${MINIMO} caracteres`
    else if (nueva === actual) nuevos.nueva = 'Tiene que ser distinta de la actual'
    if (repetida !== nueva) nuevos.repetida = 'No coincide con la nueva contraseña'
    setErrores(nuevos)
    if (Object.keys(nuevos).length === 0) cambiar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
      <Campo
        etiqueta="Contraseña actual"
        type="password"
        autoComplete="current-password"
        value={actual}
        onChange={(e) => setActual(e.target.value)}
        error={errores.actual}
      />
      <Campo
        etiqueta="Nueva contraseña"
        type="password"
        autoComplete="new-password"
        value={nueva}
        onChange={(e) => setNueva(e.target.value)}
        error={errores.nueva}
        ayuda={`Al menos ${MINIMO} caracteres`}
      />
      <Campo
        etiqueta="Repite la nueva contraseña"
        type="password"
        autoComplete="new-password"
        value={repetida}
        onChange={(e) => setRepetida(e.target.value)}
        error={errores.repetida}
      />
      <div className={estilos.acciones}>
        <Boton type="submit" cargando={cambiar.isPending}>
          Cambiar contraseña
        </Boton>
      </div>
    </form>
  )
}
