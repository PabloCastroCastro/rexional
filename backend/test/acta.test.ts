import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emparejar } from '../src/acta/emparejar.js'
import { ActaNoLegible, extraer, type FichaActa, interpretar, leerActa } from '../src/acta/leer.js'

// Lectura de la ficha del partido. La ficha de prueba copia la maquetación de una real de la
// Federación Gallega con nombres inventados: el CD Proba Rival (local) pierde 1-7 con el CD Rexional.

const FICHA = readFileSync(new URL('./fixtures/ficha-partido.pdf', import.meta.url))

// Un PDF válido que no es una ficha
const OTRO_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

let ficha: FichaActa
const leida = async () => {
  ficha ??= await leerActa(FICHA)
  return ficha
}

describe('lectura de la ficha', () => {
  it('cabecera, resultado y estadio', async () => {
    expect(await leida()).toMatchObject({
      competicion: 'TERCEIRA PROBA (GRUPO 1)',
      jornada: 5,
      fecha: '2026-10-11',
      hora: '20:00',
      estadio: 'Campo de Proba',
      ciudad: 'Rexional',
      golesLocal: 1,
      golesVisitante: 7,
    })
  })

  it('titulares y suplentes de cada equipo, con dorsal', async () => {
    const { local, visitante } = await leida()
    expect(local.nombre).toBe('CD PROBA RIVAL')
    expect(visitante.nombre).toBe('CD REXIONAL')
    expect(visitante.titulares.map((p) => p.dorsal)).toEqual([1, 2, 4, 5, 6, 8, 10, 15, 17, 18, 20])
    expect(visitante.suplentes.map((p) => p.dorsal)).toEqual([7, 12, 14, 19, 21])
    expect(visitante.titulares[2]).toEqual({ dorsal: 4, nombre: 'NDONG, ISSA' })
    expect(local.titulares).toHaveLength(11)
    expect(local.suplentes).toHaveLength(5)
  })

  it('cambios: quién entra y quién sale, con el minuto', async () => {
    const { local, visitante } = await leida()
    const resumen = (e: FichaActa['local']) =>
      e.cambios.map((c) => `${c.entra.dorsal}>${c.sale.dorsal}@${c.minuto}`)
    expect(resumen(visitante)).toEqual(['14>18@48', '12>5@59', '21>2@59', '19>10@59', '7>6@59'])
    expect(resumen(local)).toEqual(['5>3@50', '8>17@50', '7>14@50', '12>4@60', '16>10@60'])
  })

  it('tarjetas con su tipo, por el color del icono', async () => {
    const { local, visitante } = await leida()
    expect(local.tarjetas.map((t) => [t.minuto, t.tipo])).toEqual([
      [33, 'amarilla'],
      [41, 'amarilla'],
      [81, 'roja'],
    ])
    expect(visitante.tarjetas).toEqual([
      { nombre: 'BARREIRO VARELA, ANXO', minuto: 48, tipo: 'amarilla' },
    ])
  })

  it('goles en orden, de cada equipo por cómo cambia el marcador', async () => {
    const { goles } = await leida()
    expect(goles.map((g) => `${g.equipo[0]} ${g.minuto}`)).toEqual([
      'v 19',
      'v 40',
      'v 40',
      'v 50',
      'l 62',
      'v 64',
      'v 76',
      'v 90',
    ])
    expect(goles[1]).toEqual({ equipo: 'visitante', nombre: 'GÓMEZ GARCÍA, DANIEL', minuto: 40 })
  })

  // Otras fichas reales colocan los marcadores de los goles más a la izquierda que las etiquetas
  // del centro, y los goles del descuento llevan "(90'+3)"
  it('goles con los marcadores más a la izquierda y minutos del descuento', async () => {
    const { textos, iconos } = await extraer(FICHA)
    const movidos = textos.map((t) => {
      if (/^d+ - d+$/.test(t.texto)) return { ...t, x: t.x - 4 }
      if (['Árbitro', 'ESTADIO:', 'Ciudad:'].includes(t.texto)) return { ...t, x: t.x + 11 }
      if (t.texto.endsWith("(90')")) return { ...t, texto: t.texto.replace("(90')", "(90'+3)") }
      return t
    })
    const leida = interpretar({ textos: movidos, iconos })
    expect(leida.goles).toHaveLength(8)
    expect(leida.goles.at(-1)).toEqual({
      equipo: 'visitante',
      nombre: 'CARBALLO VARELA, ANXO',
      minuto: 93,
    })
    expect(leida.local.titulares).toHaveLength(11)
  })

  it('rechaza lo que no es un PDF o no es una ficha', async () => {
    await expect(leerActa(Buffer.from('hola'))).rejects.toThrow(ActaNoLegible)
    await expect(leerActa(OTRO_PDF)).rejects.toThrow(/ficha del partido/)
  })
})

describe('emparejamiento de nombres', () => {
  const plantilla = [
    { jugadorId: 'pablo', nombre: 'Pablo', apellidos: 'Castro', dorsal: 6 },
    { jugadorId: 'dani', nombre: 'Daniel', apellidos: 'Gómez García', dorsal: 9 },
    { jugadorId: 'issa', nombre: 'Issa', apellidos: null, dorsal: 4 },
    { jugadorId: 'noel', nombre: 'Noel', apellidos: null, dorsal: 3 },
    { jugadorId: 'hugo1', nombre: 'Hugo', apellidos: 'Vilas', dorsal: 7 },
    { jugadorId: 'hugo2', nombre: 'Hugo', apellidos: 'Loureiro', dorsal: 15 },
  ]
  const de = (personas: { nombre: string; dorsal: number | null }[]) =>
    Object.fromEntries(emparejar(personas, plantilla))

  it('por nombre y apellidos sin tildes; vale solo el primer apellido', () => {
    expect(
      de([
        { nombre: 'CASTRO CASTRO, PABLO', dorsal: 6 },
        { nombre: 'GOMEZ GARCIA, DANIEL', dorsal: 8 },
        { nombre: 'VILAS DOVAL, HUGO', dorsal: 7 },
        { nombre: 'LOUREIRO DOVAL, HUGO', dorsal: 15 },
      ]),
    ).toEqual({
      'CASTRO CASTRO, PABLO': 'pablo',
      'GOMEZ GARCIA, DANIEL': 'dani',
      'VILAS DOVAL, HUGO': 'hugo1',
      'LOUREIRO DOVAL, HUGO': 'hugo2',
    })
  })

  it('con solo el nombre de pila hace falta el dorsal', () => {
    expect(
      de([
        { nombre: 'NDONG, ISSA', dorsal: 4 },
        { nombre: 'BARREIRO NÚÑEZ, NOEL', dorsal: 12 },
      ]),
    ).toEqual({ 'NDONG, ISSA': 'issa', 'BARREIRO NÚÑEZ, NOEL': null })
  })

  it('sin coincidencia clara, nadie', () => {
    expect(
      de([
        { nombre: 'PENA RIVAS, PAULO', dorsal: 1 },
        { nombre: 'DOVAL PENA, HUGO', dorsal: null },
      ]),
    ).toEqual({ 'PENA RIVAS, PAULO': null, 'DOVAL PENA, HUGO': null })
  })

  it('un jugador no se asigna a dos nombres del acta', () => {
    expect(
      de([
        { nombre: 'CASTRO CASTRO, PABLO', dorsal: 6 },
        { nombre: 'CASTRO PENA, PABLO', dorsal: 11 },
      ]),
    ).toEqual({ 'CASTRO CASTRO, PABLO': 'pablo', 'CASTRO PENA, PABLO': null })
  })
})
