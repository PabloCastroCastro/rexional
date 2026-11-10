import type { Context } from 'hono'
import { ipDe, registrarEvento } from './seguridad.js'

// Avisos de violación de la Content-Security-Policy (GH-57). La CSP la pone nginx
// (proxy/templates/cabeceras.inc.template) y el navegador manda aquí lo que ha bloqueado, en uno de
// estos dos formatos:
//   report-uri (Firefox): { "csp-report": { "document-uri", "effective-directive", "blocked-uri", … } }
//   report-to (Chrome, Safari): [{ "type": "csp-violation", "body": { "documentURL", "blockedURL", … } }]
// Cada violación distinta se registra una vez cada 10 minutos como evento de seguridad, para que
// una página que falla en bucle no llene el log. Las URL van sin parámetros de consulta.

const MAXIMO_BYTES = 64 * 1024
const REPETICION_MS = 10 * 60_000
const vistas = new Map<string, number>()

type Violacion = { directiva: string; bloqueado: string; pagina: string; fuente?: string }

export async function recibirAvisoCsp(c: Context) {
  const texto = await c.req.text()
  if (texto.length > MAXIMO_BYTES) return c.body(null, 413)
  let datos: unknown
  try {
    datos = JSON.parse(texto)
  } catch {
    return c.body(null, 400)
  }
  const ip = ipDe(c.req.raw.headers)
  const ahora = Date.now()
  for (const v of violaciones(datos)) {
    const clave = `${v.directiva}|${v.bloqueado}|${v.pagina}`
    const ultima = vistas.get(clave)
    if (ultima !== undefined && ahora - ultima < REPETICION_MS) continue
    if (vistas.size > 1000) vistas.clear()
    vistas.set(clave, ahora)
    registrarEvento('csp_violada', { ...v, ip })
  }
  return c.body(null, 204)
}

function violaciones(datos: unknown): Violacion[] {
  const lista = Array.isArray(datos) ? datos : [datos]
  const resultado: Violacion[] = []
  for (const elemento of lista.slice(0, 20)) {
    if (!elemento || typeof elemento !== 'object') continue
    const e = elemento as Record<string, unknown>
    if ('csp-report' in e && e['csp-report'] && typeof e['csp-report'] === 'object') {
      const r = e['csp-report'] as Record<string, unknown>
      resultado.push(
        violacion(
          r['effective-directive'] ?? r['violated-directive'],
          r['blocked-uri'],
          r['document-uri'],
          r['source-file'],
        ),
      )
    } else if (e.type === 'csp-violation' && e.body && typeof e.body === 'object') {
      const b = e.body as Record<string, unknown>
      resultado.push(violacion(b.effectiveDirective, b.blockedURL, b.documentURL, b.sourceFile))
    }
  }
  return resultado
}

function violacion(directiva: unknown, bloqueado: unknown, pagina: unknown, fuente: unknown) {
  const v: Violacion = {
    directiva: texto(directiva, 60),
    bloqueado: sinConsulta(bloqueado),
    pagina: sinConsulta(pagina),
  }
  if (typeof fuente === 'string' && fuente) v.fuente = sinConsulta(fuente)
  return v
}

const texto = (valor: unknown, maximo: number) =>
  typeof valor === 'string' && valor ? valor.slice(0, maximo) : 'desconocido'

// Las URL, sin consulta ni fragmento; «inline», «eval», «data»… se quedan como vienen
function sinConsulta(valor: unknown) {
  const t = texto(valor, 300)
  try {
    const url = new URL(t)
    return `${url.origin}${url.pathname}`.slice(0, 200)
  } catch {
    return t.slice(0, 200)
  }
}

export const reiniciarAvisosCspParaTests = () => vistas.clear()
