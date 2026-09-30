import { describe, expect, it } from 'vitest'
import { ErrorConfiguracion, leerConfig } from '../src/config.js'

const valida = {
  ENTORNO: 'produccion',
  DATABASE_URL: 'postgres://vestuario:clave@db:5432/vestuario',
  TZ: 'Europe/Madrid',
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
    ])
  })

  it('rechaza una zona horaria distinta de Europe/Madrid', () => {
    expect(problemas({ ...valida, TZ: 'UTC' })).toEqual(['TZ: Debe ser Europe/Madrid'])
  })

  it('rechaza valores no válidos', () => {
    const p = problemas({ ...valida, ENTORNO: 'local', DATABASE_URL: 'mysql://db', PORT: '99999' })
    expect(p).toHaveLength(3)
    expect(p.map((x) => x.split(':')[0])).toEqual(['ENTORNO', 'PORT', 'DATABASE_URL'])
  })
})
