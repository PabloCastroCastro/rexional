import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  aplicarTemaGuardado,
  contraste,
  legibleSobre,
  textoSobre,
  variablesTema,
} from '../src/diseno/tema'
import { abrir, clubRexional, conDatos, plantilla } from './simulacion'

// Tema de cada club (GH-29)

const raiz = () => document.documentElement
const variable = (nombre: string) => raiz().style.getPropertyValue(nombre)

afterEach(() => {
  raiz().removeAttribute('style')
  localStorage.clear()
})

describe('colores', () => {
  it('calcula el contraste de WCAG', () => {
    expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contraste('#14553d', '#ffffff')).toBeGreaterThan(8)
    expect(contraste('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('texto blanco sobre colores oscuros y oscuro sobre los claros', () => {
    expect(textoSobre('#14553d')).toBe('#ffffff')
    expect(textoSobre('#1d3a8a')).toBe('#ffffff')
    expect(textoSobre('#f2c230')).toBe('#1b1f1d')
    expect(textoSobre('#ffffff')).toBe('#1b1f1d')
  })

  it('oscurece un color claro para leerse sobre blanco y lo aclara sobre la superficie oscura', () => {
    // Un verde oscuro ya se lee sobre blanco: tal cual
    expect(legibleSobre('#14553D', '#ffffff')).toBe('#14553d')
    for (const color of ['#f2c230', '#ffffff', '#7fd1aa', '#ff0000']) {
      expect(contraste(legibleSobre(color, '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    }
    for (const color of ['#14553d', '#000000', '#1d3a8a']) {
      expect(contraste(legibleSobre(color, '#181d1a'), '#181d1a')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('variables del tema; los colores por defecto conservan el acento oscuro elegido a mano', () => {
    expect(variablesTema({ colorPrincipal: '#F2C230', colorSecundario: '#1d3a8a' })).toMatchObject({
      '--color-primario': '#f2c230',
      '--color-sobre-primario': '#1b1f1d',
      '--color-secundario': '#1d3a8a',
      '--color-sobre-secundario': '#ffffff',
    })
    expect(
      variablesTema({ colorPrincipal: '#14553d', colorSecundario: '#f2c230' })['--acento-oscuro'],
    ).toBe('#7fd1aa')
    // Un color que no es hexadecimal no rompe nada: se usa el de por defecto
    expect(variablesTema({ colorPrincipal: 'rojo', colorSecundario: '' })).toMatchObject({
      '--color-primario': '#14553d',
      '--color-secundario': '#f2c230',
    })
  })
})

describe('aplicar el tema', () => {
  const ejemplo = {
    ...clubRexional,
    id: 'c2',
    nombre: 'UD Ejemplo',
    colorPrincipal: '#1d3a8a',
    colorSecundario: '#ffffff',
  }

  it('al abrir una plantilla, los colores de su club van a toda la app y a la barra del navegador', async () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = '#14553d'
    document.head.append(meta)
    conDatos({ plantillas: [plantilla('p1', 'Senior', '2026-27', { club: ejemplo })] })
    abrir('/plantillas/p1/mas')
    await screen.findByRole('heading', { name: 'Más' })
    expect(variable('--color-primario')).toBe('#1d3a8a')
    expect(variable('--color-sobre-primario')).toBe('#ffffff')
    expect(variable('--color-secundario')).toBe('#ffffff')
    expect(meta.content).toBe('#1d3a8a')
    // Se recuerda para el próximo arranque
    raiz().removeAttribute('style')
    aplicarTemaGuardado()
    expect(variable('--color-primario')).toBe('#1d3a8a')
    meta.remove()
  })

  it('el escudo del club en la cabecera', async () => {
    const conEscudo = { ...ejemplo, escudo: '/api/clubes/c2/escudo?v=abc' }
    conDatos({
      plantillas: [
        plantilla('p1', 'Senior', '2026-27', { club: conEscudo }),
        plantilla('p2', 'Juvenil', '2026-27'),
      ],
    })
    abrir('/plantillas/p1/mas')
    const cabecera = await screen.findByRole('banner')
    expect(cabecera.querySelector('img')).toHaveAttribute('src', '/api/clubes/c2/escudo?v=abc')
  })

  it('en el selector, cada club con su escudo', async () => {
    const conEscudo = { ...ejemplo, escudo: '/api/clubes/c2/escudo?v=abc' }
    conDatos({
      plantillas: [
        plantilla('p1', 'Senior', '2026-27'),
        plantilla('p2', 'Senior', '2026-27', { club: conEscudo }),
      ],
    })
    abrir('/plantillas')
    const ejemploClub = await screen.findByRole('region', { name: 'UD Ejemplo' })
    expect(
      within(ejemploClub).getByRole('heading', { name: 'UD Ejemplo' }).querySelector('img'),
    ).toHaveAttribute('src', '/api/clubes/c2/escudo?v=abc')
    const rexional = screen.getByRole('region', { name: 'CD Rexional' })
    expect(
      within(rexional).getByRole('heading', { name: 'CD Rexional' }).querySelector('svg'),
    ).not.toBeNull()
  })
})
