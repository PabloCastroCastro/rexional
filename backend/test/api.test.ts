import { createRoute, z } from '@hono/zod-openapi'
import { describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { ErrorApi } from '../src/errores.js'

describe('GET /api/health', () => {
  it('responde 200 con la base de datos de test', async () => {
    const res = await crearApp().request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ estado: 'ok', api: 'ok', baseDeDatos: 'ok' })
  })

  it('responde 503 si la base de datos no responde', async () => {
    const res = await crearApp({ comprobarBaseDeDatos: async () => false }).request('/api/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ estado: 'error', api: 'ok', baseDeDatos: 'error' })
  })
})

describe('documentación', () => {
  it('publica el contrato y la documentación cuando está activada', async () => {
    const app = crearApp({ documentacion: true })
    const contrato = await app.request('/api/openapi.json')
    expect(contrato.status).toBe(200)
    expect((await contrato.json()).paths).toHaveProperty('/api/health')
    expect((await app.request('/api/docs')).status).toBe(200)
  })

  it('no la publica cuando está desactivada (producción)', async () => {
    const app = crearApp({ documentacion: false })
    expect((await app.request('/api/openapi.json')).status).toBe(404)
    expect((await app.request('/api/docs')).status).toBe(404)
  })
})

describe('formato de error común', () => {
  // Rutas de prueba sobre la app real, con su validación y su manejador de errores
  const app = crearApp()
  app.openapi(
    createRoute({
      method: 'post',
      path: '/prueba',
      request: {
        body: {
          content: {
            'application/json': {
              schema: z.object({ nombre: z.string().min(1), dorsal: z.number().int().max(99) }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
        },
      },
    }),
    (c) => c.json({ ok: true }, 200),
  )
  app.get('/error-api', () => {
    throw new ErrorApi(409, 'dorsal_en_uso', 'El dorsal 7 ya está en uso')
  })
  app.get('/fallo', () => {
    throw new Error('detalle interno secreto')
  })

  const post = (cuerpo: string) =>
    app.request('/api/prueba', {
      method: 'POST',
      body: cuerpo,
      headers: { 'content-type': 'application/json' },
    })

  it('ruta inexistente: 404', async () => {
    const res = await app.request('/api/no-existe')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: { codigo: 'no_encontrado', mensaje: 'No existe la ruta GET /api/no-existe' },
    })
  })

  it('datos no válidos: 400 con los campos que fallan, en español', async () => {
    const res = await post(JSON.stringify({ nombre: '', dorsal: 120 }))
    expect(res.status).toBe(400)
    const { error } = await res.json()
    expect(error.codigo).toBe('validacion')
    expect(error.detalles.map((d: { campo: string }) => d.campo)).toEqual(['nombre', 'dorsal'])
    expect(error.detalles[1].mensaje).toMatch(/demasiado grande/i)
  })

  it('datos válidos: pasan la validación', async () => {
    const res = await post(JSON.stringify({ nombre: 'Brais', dorsal: 7 }))
    expect(res.status).toBe(200)
  })

  it('JSON mal formado: 400', async () => {
    const res = await post('{ no es json')
    expect(res.status).toBe(400)
    expect((await res.json()).error.codigo).toBe('peticion_invalida')
  })

  it('error de negocio: su estado y su código', async () => {
    const res = await app.request('/api/error-api')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: { codigo: 'dorsal_en_uso', mensaje: 'El dorsal 7 ya está en uso' },
    })
  })

  it('error inesperado: 500 sin detalles internos', async () => {
    const res = await app.request('/api/fallo')
    expect(res.status).toBe(500)
    const texto = await res.text()
    expect(JSON.parse(texto).error.codigo).toBe('error_interno')
    expect(texto).not.toContain('secreto')
  })
})
