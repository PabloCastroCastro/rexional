import { TEXTO_RESULTADO, textoResultado, tipoResultado } from './datos'

// El resultado («2–1»), con «Victoria, », «Empate, » o «Derrota, » delante para el lector de
// pantalla: el color no es la única pista (GH-228)
export function Resultado({
  partido,
}: {
  partido: { golesFavor: number | null; golesContra: number | null }
}) {
  const tipo = tipoResultado(partido)
  return (
    <>
      {tipo && <span className="solo-lectores">{TEXTO_RESULTADO[tipo]}, </span>}
      {textoResultado(partido)}
    </>
  )
}
