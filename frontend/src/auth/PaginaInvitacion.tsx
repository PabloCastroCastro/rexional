import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, LogIn, LogOut } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { api, datos, ErrorApi, erroresPorCampo } from '../api/cliente'
import type { components } from '../api/esquema'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import { CampoContrasena } from './CampoContrasena'
import estilos from './PaginaLogin.module.css'
import { CLAVE_SESION, cerrarSesion, iniciarSesion, useSesion } from './sesion'

// Aceptar una invitación (GH-50). El enlace lleva el token tras «#»: se lee al abrir la página y se
// quita de la barra de direcciones; solo vive en memoria. La invitación es para un email: sin cuenta
// se crea aquí; con cuenta, hay que entrar con ella.

type Invitacion = components['schemas']['InvitacionAbierta']

const LONGITUD_MINIMA = 10

const ROLES: Record<NonNullable<Invitacion['rol']>, string> = {
  admin: 'administrador',
  entrenador: 'entrenador',
  delegado: 'delegado',
  jugador: 'jugador',
}

export function PaginaInvitacion() {
  const [token] = useState(() => window.location.hash.slice(1))
  const sesion = useSesion()

  // Fuera de la barra de direcciones (y del historial) en cuanto se ha leído
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
    }
  }, [])

  const consulta = useQuery({
    queryKey: ['invitacion', token],
    queryFn: () => datos(api.POST('/api/invitaciones/consultar', { body: { token } })),
    enabled: token.length > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })

  let contenido: ReactNode
  if (!token) {
    contenido = (
      <Problema mensaje="El enlace de la invitación no es válido. Ábrelo tal como te lo enviaron." />
    )
  } else if (consulta.isPending || sesion.isPending) {
    contenido = <Cargando />
  } else if (consulta.isError) {
    contenido = <Problema mensaje={consulta.error.message} />
  } else {
    contenido = (
      <Aceptar token={token} invitacion={consulta.data} emailSesion={sesion.data?.user.email} />
    )
  }

  return (
    <main className={estilos.login}>
      <img src="/logo.svg" alt="" width={72} height={72} className={estilos.logo} />
      <h1>Vestuario</h1>
      {contenido}
    </main>
  )
}

function Problema({ mensaje }: { mensaje: string }) {
  return (
    <section className={estilos.formulario}>
      <h2 className={estilos.titulo}>No se puede usar esta invitación</h2>
      <p className={estilos.error} role="alert">
        {mensaje}
      </p>
      <a href="/" className={estilos.enlace}>
        Ir a Vestuario
      </a>
    </section>
  )
}

const aQue = (i: Invitacion) =>
  i.plantilla ? (
    <>
      Te invitan a <strong>{i.plantilla.nombre}</strong> ({i.plantilla.temporada}) de{' '}
      <strong>{i.club}</strong> como <strong>{ROLES[i.rol ?? 'jugador']}</strong>.
    </>
  ) : (
    <>
      Te invitan a ser <strong>administrador</strong> de <strong>{i.club}</strong>.
    </>
  )

function Aceptar({
  token,
  invitacion,
  emailSesion,
}: {
  token: string
  invitacion: Invitacion
  emailSesion: string | undefined
}) {
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const [nombre, setNombre] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [repetida, setRepetida] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})
  // Si al aceptar resulta que ya hay cuenta (la han creado mientras tanto), se pide entrar
  const [conCuenta, setConCuenta] = useState(invitacion.cuentaExiste)

  const otroEmail =
    emailSesion && emailSesion.toLowerCase() !== invitacion.email ? emailSesion : null

  const aceptar = useMutation({
    mutationFn: async () => {
      if (!emailSesion && conCuenta) await iniciarSesion(invitacion.email, contrasena)
      return datos(
        api.POST('/api/invitaciones/aceptar', {
          body: conCuenta || emailSesion ? { token } : { token, nombre: nombre.trim(), contrasena },
        }),
      )
    },
    onSuccess: async ({ plantillaId }) => {
      // Con la sesión nueva y la plantilla nueva: todo lo de antes ya no vale
      await cliente.invalidateQueries()
      navegar(plantillaId ? `/plantillas/${plantillaId}` : '/', { replace: true })
    },
    onError: (error) => {
      if (error instanceof ErrorApi && error.codigo === 'inicia_sesion') setConCuenta(true)
      // Puede haber entrado y fallar después: la sesión cambia
      cliente.invalidateQueries({ queryKey: CLAVE_SESION })
      const porCampo = erroresPorCampo(error)
      setErrores(
        Object.keys(porCampo).length > 0
          ? porCampo
          : { general: error instanceof Error ? error.message : 'No se ha podido aceptar' },
      )
    },
  })

  const salir = useMutation({
    mutationFn: cerrarSesion,
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_SESION }),
  })

  function enviar(e: FormEvent) {
    e.preventDefault()
    setErrores({})
    if (!emailSesion && !conCuenta) {
      const faltan: Record<string, string> = {}
      if (!nombre.trim()) faltan.nombre = 'Escribe tu nombre'
      if (contrasena.length < LONGITUD_MINIMA) {
        faltan.contrasena = `La contraseña debe tener al menos ${LONGITUD_MINIMA} caracteres`
      } else if (contrasena !== repetida) {
        faltan.contrasena = 'Las contraseñas no coinciden'
      }
      if (Object.keys(faltan).length > 0) {
        setErrores(faltan)
        return
      }
    }
    aceptar.mutate()
  }

  const error = errores.general ?? errores.contrasena

  if (otroEmail) {
    return (
      <section className={estilos.formulario}>
        <p>{aQue(invitacion)}</p>
        <p className={estilos.aviso} role="status">
          Has entrado como <strong>{otroEmail}</strong> y la invitación es para{' '}
          <strong>{invitacion.email}</strong>. Cierra sesión para aceptarla con esa cuenta.
        </p>
        <Boton
          variante="secundario"
          anchoCompleto
          cargando={salir.isPending}
          icono={<LogOut aria-hidden size={18} />}
          onClick={() => salir.mutate()}
        >
          Cerrar sesión
        </Boton>
      </section>
    )
  }

  return (
    <form className={estilos.formulario} onSubmit={enviar} noValidate>
      <p>{aQue(invitacion)}</p>
      {invitacion.jugador && (
        <p className={estilos.secundario}>Tu ficha de jugador: {invitacion.jugador}</p>
      )}
      {error && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      <Campo
        etiqueta="Email"
        type="email"
        autoComplete="username"
        value={invitacion.email}
        readOnly
      />
      {!emailSesion && !conCuenta && (
        <>
          <Campo
            etiqueta="Tu nombre"
            autoComplete="name"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            error={errores.nombre}
          />
          <CampoContrasena
            etiqueta="Contraseña"
            autoComplete="new-password"
            required
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
          />
          <CampoContrasena
            etiqueta="Repite la contraseña"
            autoComplete="new-password"
            required
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
          />
          <p className={estilos.secundario}>Mínimo {LONGITUD_MINIMA} caracteres.</p>
        </>
      )}
      {!emailSesion && conCuenta && (
        <>
          <p className={estilos.secundario}>
            Ya tienes cuenta con este email: entra con tu contraseña para aceptar.
          </p>
          <CampoContrasena
            etiqueta="Contraseña"
            autoComplete="current-password"
            required
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
          />
        </>
      )}
      <Boton
        type="submit"
        anchoCompleto
        cargando={aceptar.isPending}
        disabled={!emailSesion && conCuenta && !contrasena}
        icono={emailSesion ? <Check aria-hidden size={18} /> : <LogIn aria-hidden size={18} />}
      >
        {emailSesion
          ? 'Aceptar invitación'
          : conCuenta
            ? 'Entrar y aceptar'
            : 'Crear cuenta y entrar'}
      </Boton>
    </form>
  )
}
