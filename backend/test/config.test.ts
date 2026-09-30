import { describe, expect, it } from 'vitest'
import { ErrorConfiguracion, leerConfig } from '../src/config.js'

const valida = {
  ENTORNO: 'produccion',
  DATABASE_URL: 'postgres://vestuario:clave@db:5432/vestuario',
  TZ: 'Europe/Madrid',
  BETTER_AUTH_SECRET: 's'.repeat(32),
  URL_PUBLICA: 'https://vestuario.test:8443/',
}

const problemas = (env: Record<string, string | undefined>) => {
  try {
    leerConfig(env)
  } catch (error) {
    if (error instanceof ErrorConfiguracion) return error.problemas
    throw error
  }
  return []
}

describe('configuración', () => {
  it('aplica los valores por defecto', () => {
    expect(leerConfig(valida)).toEqual({
      entorno: 'produccion',
      puerto: 3000,
      baseDeDatos: { url: valida.DATABASE_URL, poolMax: 10, timeoutConexionMs: 5000 },
      zonaHoraria: 'Europe/Madrid',
      secretoAuth: 's'.repeat(32),
      // Sin la barra final: se compara con la cabecera Origin
      urlPublica: 'https://vestuario.test:8443',
      nivelLog: 'info',
    })
  })

  it('convierte los números', () => {
    const c = leerConfig({ ...valida, PORT: '8081', DB_POOL_MAX: '5', LOG_LEVEL: 'debug' })
    expect(c.puerto).toBe(8081)
    expect(c.baseDeDatos.poolMax).toBe(5)
    expect(c.nivelLog).toBe('debug')
  })

  it('indica todas las variables que faltan', () => {
    expect(problemas({})).toEqual([
      'ENTORNO: falta la variable',
      'DATABASE_URL: falta la variable',
      'TZ: falta la variable',
      'BETTER_AUTH_SECRET: falta la variable',
      'URL_PUBLICA: falta la variable',
    ])
  })

  it('rechaza una zona horaria distinta de Europe/Madrid', () => {
    expect(problemas({ ...valida, TZ: 'UTC' })).toEqual(['TZ: Debe ser Europe/Madrid'])
  })

  it('exige un secreto de al menos 32 caracteres y una URL pública http(s)', () => {
    const p = problemas({
      ...valida,
      BETTER_AUTH_SECRET: 'corto',
      URL_PUBLICA: 'ftp://vestuario.test',
    })
    expect(p.map((x) => x.split(':')[0])).toEqual(['BETTER_AUTH_SECRET', 'URL_PUBLICA'])
  })

  it('rechaza valores no válidos', () => {
    const p = problemas({ ...valida, ENTORNO: 'local', DATABASE_URL: 'mysql://db', PORT: '99999' })
    expect(p).toHaveLength(3)
    expect(p.map((x) => x.split(':')[0])).toEqual(['ENTORNO', 'PORT', 'DATABASE_URL'])
  })
})
