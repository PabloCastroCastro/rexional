import { randomUUID } from 'node:crypto'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { App } from '../src/app.js'
import { auth } from '../src/auth.js'
import { db } from '../src/db/cliente.js'
import { account, user } from '../src/db/schema/index.js'

export const ORIGEN = 'http://localhost:5173'
export const CONTRASENA = 'contraseña-de-prueba'

// IP distinta en cada inicio de sesión, para no alcanzar el límite de 5 por minuto
let ip = 0
const siguienteIp = () => {
  ip += 1
  return `10.200.${Math.floor(ip / 250)}.${ip % 250}`
}

// Usuario con contraseña, listo para iniciar sesión. Email único: la base de test se reutiliza.
export async function crearUsuario(nombre: string) {
  const email = `${nombre.toLowerCase().replace(/\W+/g, '-')}-${randomUUID().slice(0, 8)}@prueba.test`
  const [usuario] = await db
    .insert(user)
    .values({ name: nombre, email, emailVerified: true })
    .returning()
  if (!usuario) throw new Error('No se pudo crear el usuario')
  const hash = await (await auth.$context).password.hash(CONTRASENA)
  await db.insert(account).values({
    accountId: usuario.id,
    providerId: 'credential',
    userId: usuario.id,
    password: hash,
  })
  return usuario
}

// Inicia sesión y devuelve la cabecera Cookie con la sesión
export async function iniciarSesion(app: App, email: string) {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { origin: ORIGEN, 'content-type': 'application/json', 'x-real-ip': siguienteIp() },
    body: JSON.stringify({ email, password: CONTRASENA }),
  })
  if (res.status !== 200) throw new Error(`No se pudo iniciar sesión (${res.status})`)
  const cookie = res.headers.getSetCookie().find((c) => c.includes('vestuario.session_token='))
  if (!cookie) throw new Error('Sin cookie de sesión')
  return cookie.split(';')[0] ?? ''
}

// Texto de un PDF, página a página, para comprobar lo que lleva. pdfmake escribe cada palabra por
// separado y los importes llevan espacio duro: los espacios se normalizan
export async function textoPdf(res: Response) {
  const datos = new Uint8Array(await res.arrayBuffer())
  const documento = await getDocument({ data: datos, verbosity: 0, isEvalSupported: false }).promise
  const paginas: string[] = []
  for (let n = 1; n <= documento.numPages; n++) {
    const contenido = await (await documento.getPage(n)).getTextContent()
    paginas.push(
      contenido.items
        .map((i) => ('str' in i ? i.str : ''))
        .join(' ')
        .replace(/\s+/g, ' '),
    )
  }
  await documento.destroy()
  return paginas.join('\n')
}
