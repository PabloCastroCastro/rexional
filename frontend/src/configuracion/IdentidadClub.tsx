import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'
import { api, datos, ErrorApi } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EscudoClub } from '../diseno/EscudoClub'
import { POR_DEFECTO, variablesTema } from '../diseno/tema'
import { textoMb, useLimites } from '../ejercicios/datos'
import { CLAVE_CLUBES, CLAVE_PLANTILLAS } from '../plantillas/datos'
import estilos from './Configuracion.module.css'

// Identidad del club (GH-30), solo para sus administradores: escudo y colores, comunes a todas sus
// plantillas. El escudo se ve antes de subirlo y los colores, en una vista previa en vivo antes de
// guardarlos.

type Club = {
  id: string
  nombre: string
  escudo: string | null
  colorPrincipal: string
  colorSecundario: string
}

const TIPOS_ESCUDO = ['image/png', 'image/webp']

// El escudo va en un formulario y la API lo lee en streaming: fetch directo, sin el cliente tipado
async function subirEscudo(clubId: string, archivo: File) {
  const formulario = new FormData()
  formulario.append('archivo', archivo)
  const respuesta = await fetch(`/api/clubes/${clubId}/escudo`, {
    method: 'PUT',
    body: formulario,
    credentials: 'same-origin',
  })
  const cuerpo = (await respuesta.json().catch(() => null)) as {
    error?: { codigo?: string; mensaje?: string }
  } | null
  if (!respuesta.ok) {
    throw new ErrorApi(
      respuesta.status,
      cuerpo?.error?.codigo ?? 'error',
      cuerpo?.error?.mensaje ?? 'No se ha podido subir el escudo',
    )
  }
}

// Tras cualquier cambio: el escudo y los colores llegan con las plantillas (cabecera, tema) y los clubes
function useRefrescar() {
  const cliente = useQueryClient()
  return () =>
    Promise.all([
      cliente.invalidateQueries({ queryKey: CLAVE_PLANTILLAS }),
      cliente.invalidateQueries({ queryKey: CLAVE_CLUBES }),
    ])
}

export function IdentidadClub({ club }: { club: Club }) {
  return (
    <div className={estilos.formulario}>
      <Escudo club={club} />
      <Colores club={club} />
    </div>
  )
}

function Escudo({ club }: { club: Club }) {
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const refrescar = useRefrescar()
  const limites = useLimites()
  const entrada = useRef<HTMLInputElement>(null)
  const [elegido, setElegido] = useState<{ archivo: File; vista: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // La vista previa es una URL del navegador: se libera al cambiarla o al salir
  useEffect(() => () => (elegido ? URL.revokeObjectURL(elegido.vista) : undefined), [elegido])

  const subir = useMutation({
    mutationFn: (archivo: File) => subirEscudo(club.id, archivo),
    onSuccess: async () => {
      setElegido(null)
      await refrescar()
      avisar({ tipo: 'exito', mensaje: 'Escudo guardado' })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido subir el escudo'),
  })

  const quitar = useMutation({
    mutationFn: () =>
      datos(api.DELETE('/api/clubes/{cid}/escudo', { params: { path: { cid: club.id } } })),
    onSuccess: async () => {
      await refrescar()
      avisar({ tipo: 'exito', mensaje: 'Escudo quitado' })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido quitar el escudo'),
  })

  function elegir(archivo: File | undefined) {
    if (!archivo) return
    setError(null)
    if (!TIPOS_ESCUDO.includes(archivo.type)) {
      return setError('El escudo tiene que ser una imagen PNG o WebP')
    }
    const maximo = limites.data?.maxEscudoBytes
    if (maximo && archivo.size > maximo) {
      return setError(`El escudo no puede pasar de ${textoMb(maximo)}`)
    }
    setElegido({ archivo, vista: URL.createObjectURL(archivo) })
  }

  async function pedirQuitar() {
    const ok = await confirmar({
      titulo: '¿Quitar el escudo?',
      mensaje: 'Todas las plantillas del club volverán a mostrar el escudo genérico.',
      textoConfirmar: 'Quitar el escudo',
      peligrosa: true,
    })
    if (ok) quitar.mutate()
  }

  return (
    <fieldset className={estilos.grupo}>
      <legend>Escudo</legend>
      <div className={estilos.escudo}>
        {elegido ? (
          <img src={elegido.vista} alt="Vista previa del escudo nuevo" width={72} height={72} />
        ) : (
          <EscudoClub escudo={club.escudo} tamano={72} />
        )}
        <p className={estilos.descripcion}>
          {elegido
            ? 'Así se verá. Guárdalo para que lo vean todas las plantillas.'
            : `PNG o WebP${limites.data ? `, hasta ${textoMb(limites.data.maxEscudoBytes)}` : ''}. Mejor cuadrado y con fondo transparente.`}
        </p>
      </div>
      <input
        ref={entrada}
        type="file"
        accept="image/png,image/webp"
        hidden
        aria-label="Escudo del club"
        onChange={(e) => {
          elegir(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {error && (
        <p className={estilos.aviso} role="alert">
          {error}
        </p>
      )}
      <div className={estilos.acciones}>
        {elegido ? (
          <>
            <Boton
              cargando={subir.isPending}
              icono={<Save aria-hidden size={18} />}
              onClick={() => subir.mutate(elegido.archivo)}
            >
              Guardar escudo
            </Boton>
            <Boton variante="secundario" onClick={() => setElegido(null)}>
              Cancelar
            </Boton>
          </>
        ) : (
          <>
            <Boton
              variante="secundario"
              icono={<ImagePlus aria-hidden size={18} />}
              onClick={() => entrada.current?.click()}
            >
              {club.escudo ? 'Cambiar escudo' : 'Subir escudo'}
            </Boton>
            {club.escudo && (
              <Boton
                variante="secundario"
                cargando={quitar.isPending}
                icono={<Trash2 aria-hidden size={18} />}
                onClick={pedirQuitar}
              >
                Quitar escudo
              </Boton>
            )}
          </>
        )}
      </div>
    </fieldset>
  )
}

function Colores({ club }: { club: Club }) {
  const { avisar } = useAvisos()
  const refrescar = useRefrescar()
  const id = useId()
  const [principal, setPrincipal] = useState(club.colorPrincipal)
  const [secundario, setSecundario] = useState(club.colorSecundario)

  // Si el club cambia (otro administrador, restablecer), el formulario lo sigue
  useEffect(() => {
    setPrincipal(club.colorPrincipal)
    setSecundario(club.colorSecundario)
  }, [club.colorPrincipal, club.colorSecundario])

  const guardar = useMutation({
    mutationFn: (colores: { colorPrincipal: string | null; colorSecundario: string | null }) =>
      datos(api.PATCH('/api/clubes/{cid}', { params: { path: { cid: club.id } }, body: colores })),
    onSuccess: async (_club, colores) => {
      await refrescar()
      avisar({
        tipo: 'exito',
        mensaje: colores.colorPrincipal ? 'Colores guardados' : 'Colores por defecto restablecidos',
      })
    },
    onError: (e) =>
      avisar({
        tipo: 'error',
        mensaje: e instanceof Error ? e.message : 'No se ha podido guardar',
      }),
  })

  const hayCambios = principal !== club.colorPrincipal || secundario !== club.colorSecundario
  const sonLosDeSiempre =
    club.colorPrincipal === POR_DEFECTO.colorPrincipal &&
    club.colorSecundario === POR_DEFECTO.colorSecundario
  // La vista previa usa las mismas variables que el tema, solo dentro de su recuadro
  const vista = variablesTema({ colorPrincipal: principal, colorSecundario: secundario })

  return (
    <fieldset className={estilos.grupo}>
      <legend>Colores</legend>
      <div className={estilos.colores}>
        <label htmlFor={`${id}-principal`} className={estilos.color}>
          <input
            id={`${id}-principal`}
            type="color"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
          />
          <span>
            Principal
            <span className={estilos.descripcion}>Cabecera y botones · {principal}</span>
          </span>
        </label>
        <label htmlFor={`${id}-secundario`} className={estilos.color}>
          <input
            id={`${id}-secundario`}
            type="color"
            value={secundario}
            onChange={(e) => setSecundario(e.target.value)}
          />
          <span>
            Secundario
            <span className={estilos.descripcion}>Franja y dorsales · {secundario}</span>
          </span>
        </label>
      </div>

      <section
        className={estilos.vistaPrevia}
        style={vista as CSSProperties}
        aria-label="Vista previa"
      >
        <div className={estilos.vistaCabecera}>
          <EscudoClub escudo={club.escudo} tamano={32} conPlaca />
          <span>{club.nombre}</span>
        </div>
        <div className={estilos.vistaCuerpo}>
          <span className={estilos.vistaDorsal}>7</span>
          <span className={estilos.vistaBoton}>Botón</span>
          <span className={estilos.vistaEnlace}>Enlace</span>
          <span className={estilos.vistaIndicador} aria-hidden="true" />
        </div>
      </section>

      <div className={estilos.acciones}>
        <Boton
          cargando={guardar.isPending && guardar.variables?.colorPrincipal !== null}
          disabled={!hayCambios}
          icono={<Save aria-hidden size={18} />}
          onClick={() => guardar.mutate({ colorPrincipal: principal, colorSecundario: secundario })}
        >
          Guardar colores
        </Boton>
        <Boton
          variante="secundario"
          disabled={sonLosDeSiempre && !hayCambios}
          cargando={guardar.isPending && guardar.variables?.colorPrincipal === null}
          icono={<RotateCcw aria-hidden size={18} />}
          onClick={() => guardar.mutate({ colorPrincipal: null, colorSecundario: null })}
        >
          Restablecer los de por defecto
        </Boton>
      </div>
    </fieldset>
  )
}
