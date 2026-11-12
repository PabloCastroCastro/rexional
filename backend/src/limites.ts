import { config } from './config.js'
import { ErrorApi } from './errores.js'
import { registrarEvento } from './seguridad.js'

// Límites de peticiones de cada usuario con sesión (GH-58), además de los de nginx por IP. En
// memoria, como el límite de intentos de Better Auth: hay un solo backend y, si se reinicia, los
// contadores empiezan de cero.
//   general: todas las peticiones con sesión
//   costosas: subidas de archivos, lectura de actas y calendarios, PDF y Excel

type Tipo = 'general' | 'costosas'

const RUTAS_COSTOSAS: [metodo: string, ruta: RegExp][] = [
  ['POST', /\/medios$/],
  ['PUT', /\/clubes\/[^/]+\/escudo$/],
  ['POST', /\/partidos\/[^/]+\/archivos$/],
  ['POST', /\/partidos\/[^/]+\/acta$/],
  ['POST', /\/partidos\/calendario\/leer$/],
  ['GET', /\.(pdf|xlsx)$/],
]

export const esCostosa = (metodo: string, ruta: string) =>
  RUTAS_COSTOSAS.some(([m, r]) => m === metodo && r.test(ruta))

// Ventana fija: cuenta las peticiones de cada clave durante la ventana y vuelve a cero al acabar
class Ventana {
  private readonly cuentas = new Map<string, { inicio: number; cuenta: number; avisado: boolean }>()

  constructor(
    public maximo: number,
    public readonly duracionMs: number,
  ) {}

  // null si se admite; si no, los milisegundos que faltan para que se admita
  registrar(clave: string, ahora = Date.now()): { esperaMs: number; primeraVez: boolean } | null {
    if (this.cuentas.size > 10_000) this.limpiar(ahora)
    let entrada = this.cuentas.get(clave)
    if (!entrada || ahora - entrada.inicio >= this.duracionMs) {
      entrada = { inicio: ahora, cuenta: 0, avisado: false }
      this.cuentas.set(clave, entrada)
    }
    entrada.cuenta += 1
    if (entrada.cuenta <= this.maximo) return null
    const primeraVez = !entrada.avisado
    entrada.avisado = true
    return { esperaMs: entrada.inicio + this.duracionMs - ahora, primeraVez }
  }

  limpiar(ahora = Date.now()) {
    for (const [clave, e] of this.cuentas) {
      if (ahora - e.inicio >= this.duracionMs) this.cuentas.delete(clave)
    }
  }

  reiniciar() {
    this.cuentas.clear()
  }
}

const ventanas: Record<Tipo, Ventana> = {
  general: new Ventana(config.limites.peticionesPorMinuto, 60_000),
  costosas: new Ventana(config.limites.costosasCada10Min, 10 * 60_000),
}

// Lanza un 429 con Retry-After si el usuario ha superado alguno de sus límites
export function comprobarLimites(usuarioId: string, metodo: string, ruta: string, ip: string) {
  const tipos: Tipo[] = esCostosa(metodo, ruta) ? ['general', 'costosas'] : ['general']
  for (const tipo of tipos) {
    const superado = ventanas[tipo].registrar(usuarioId)
    if (!superado) continue
    // Se registra una vez por ventana, no en cada petición rechazada
    if (superado.primeraVez) {
      registrarEvento('limite_superado', { limite: tipo, usuarioId, ip, metodo, ruta })
    }
    const segundos = Math.max(1, Math.ceil(superado.esperaMs / 1000))
    throw new ErrorApi(429, 'demasiadas_peticiones', mensajeEspera(segundos), undefined, {
      'Retry-After': String(segundos),
    })
  }
}

export const mensajeEspera = (segundos: number) => {
  const minutos = Math.ceil(segundos / 60)
  const cuanto =
    segundos < 60 ? `${segundos} segundos` : minutos === 1 ? '1 minuto' : `${minutos} minutos`
  return `Demasiadas peticiones. Espera ${cuanto} y vuelve a probar.`
}

// Para los tests: cambia los máximos y empieza de cero
export function configurarLimitesParaTests(maximos: Partial<Record<Tipo, number>>) {
  for (const [tipo, maximo] of Object.entries(maximos) as [Tipo, number][]) {
    ventanas[tipo].maximo = maximo
  }
  for (const v of Object.values(ventanas)) v.reiniciar()
}
