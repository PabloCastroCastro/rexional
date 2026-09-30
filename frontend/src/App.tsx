import { useEffect, useState } from 'react'

type EstadoApi = 'comprobando' | 'ok' | 'error'

// Pantalla provisional (GH-2): comprueba que la cadena frontend → /api → backend funciona.
// La aplicación real empieza con GH-9.
export function App() {
  const [estado, setEstado] = useState<EstadoApi>('comprobando')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setEstado(res.ok ? 'ok' : 'error'))
      .catch(() => setEstado('error'))
  }, [])

  return (
    <main>
      <h1>Vestuario</h1>
      <p>
        API: <strong data-estado={estado}>{textoEstado[estado]}</strong>
      </p>
    </main>
  )
}

const textoEstado: Record<EstadoApi, string> = {
  comprobando: 'comprobando…',
  ok: 'disponible',
  error: 'no responde',
}
