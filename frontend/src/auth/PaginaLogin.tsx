import { useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ErrorApi } from '../api/cliente'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import estilos from './PaginaLogin.module.css'
import { CLAVE_SESION, consumirSesionCaducada, iniciarSesion, useSesion } from './sesion'

export function PaginaLogin() {
  const sesion = useSesion()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const ubicacion = useLocation()
  const volver = (ubicacion.state as { volver?: string } | null)?.volver ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verContrasena, setVerContrasena] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [caducada] = useState(consumirSesionCaducada)

  if (sesion.isPending) return <Cargando />
  if (sesion.data) return <Navigate to={volver} replace />

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setEnviando(true)
    try {
      await iniciarSesion(email.trim(), password)
      await cliente.invalidateQueries({ queryKey: CLAVE_SESION })
      navegar(volver, { replace: true })
    } catch (err) {
      setError(
        err instanceof ErrorApi
          ? err.message
          : 'No se ha podido iniciar sesión. Inténtalo de nuevo.',
      )
      setEnviando(false)
    }
  }

  return (
    <main className={estilos.login}>
      <img src="/logo.svg" alt="" width={72} height={72} className={estilos.logo} />
      <h1>Vestuario</h1>

      <form className={estilos.formulario} onSubmit={entrar} noValidate>
        {caducada && !error && (
          <p className={estilos.aviso} role="status">
            Tu sesión ha caducado. Vuelve a entrar para continuar.
          </p>
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
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className={estilos.contrasena}>
          <Campo
            etiqueta="Contraseña"
            type={verContrasena ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className={estilos.ver}
            onClick={() => setVerContrasena((v) => !v)}
            aria-label={verContrasena ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
            aria-pressed={verContrasena}
          >
            {verContrasena ? <EyeOff aria-hidden size={20} /> : <Eye aria-hidden size={20} />}
          </button>
        </div>
        <Boton
          type="submit"
          anchoCompleto
          cargando={enviando}
          disabled={!email.trim() || !password}
          icono={<LogIn aria-hidden size={18} />}
        >
          Entrar
        </Boton>
      </form>
    </main>
  )
}
