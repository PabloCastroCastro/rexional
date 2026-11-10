// Navegador y sistema de un User-Agent, para mostrar las sesiones abiertas («Chrome en Android»). No
// pretende ser exacto: basta con que cada uno reconozca sus dispositivos. El orden importa: Edge y
// Samsung Internet también dicen «Chrome», y Chrome también dice «Safari».

const NAVEGADORES: [RegExp, string][] = [
  [/EdgA?\/|EdgiOS\//, 'Edge'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const SISTEMAS: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPod/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'Mac'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
]

const buscar = (ua: string, lista: [RegExp, string][]) => lista.find(([r]) => r.test(ua))?.[1]

export function describirDispositivo(userAgent: string | null | undefined) {
  const ua = userAgent ?? ''
  return { navegador: buscar(ua, NAVEGADORES) ?? null, sistema: buscar(ua, SISTEMAS) ?? null }
}
