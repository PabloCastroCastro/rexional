import { Plus, Save, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { HojaInferior } from '../componentes/HojaInferior'
import estilos from './PaginaComponentes.module.css'

const colores = [
  'primario',
  'secundario',
  'fondo',
  'superficie',
  'superficie-alterna',
  'texto',
  'texto-suave',
  'borde',
  'peligro',
  'exito',
  'aviso',
  'informacion',
  'acento',
]

// Catálogo de componentes, solo en desarrollo: para verlos y probarlos en claro y oscuro
export function PaginaComponentes() {
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const [hojaAbierta, setHojaAbierta] = useState(false)
  const [cargando, setCargando] = useState(false)

  return (
    <div className={estilos.catalogo}>
      <h1>Componentes</h1>

      <section className={estilos.seccion}>
        <h2>Colores</h2>
        <div className={estilos.colores}>
          {colores.map((color) => (
            <div key={color} className={estilos.color}>
              <span className={estilos.muestra} style={{ background: `var(--color-${color})` }} />
              <code>--color-{color}</code>
            </div>
          ))}
        </div>
      </section>

      <section className={estilos.seccion}>
        <h2>Botones</h2>
        <div className={estilos.fila}>
          <Boton icono={<Plus aria-hidden size={18} />}>Primario</Boton>
          <Boton variante="secundario">Secundario</Boton>
          <Boton variante="peligro" icono={<Trash2 aria-hidden size={18} />}>
            Peligro
          </Boton>
          <Boton variante="texto">Texto</Boton>
          <Boton disabled>Desactivado</Boton>
          <Boton
            cargando={cargando}
            onClick={() => {
              setCargando(true)
              setTimeout(() => setCargando(false), 1500)
            }}
          >
            {cargando ? 'Guardando…' : 'Con carga'}
          </Boton>
        </div>
      </section>

      <section className={estilos.seccion}>
        <h2>Campos</h2>
        <Campo etiqueta="Nombre" placeholder="Brais Iglesias" required />
        <Campo etiqueta="Dorsal" inputMode="numeric" ayuda="Entre 0 y 99, opcional" />
        <Campo etiqueta="Dorsal" defaultValue="7" error="El dorsal 7 ya lo tiene Diego Pereira" />
      </section>

      <section className={estilos.seccion}>
        <h2>Hoja inferior, confirmación y avisos</h2>
        <div className={estilos.fila}>
          <Boton variante="secundario" onClick={() => setHojaAbierta(true)}>
            Abrir hoja
          </Boton>
          <Boton
            variante="secundario"
            onClick={async () => {
              const ok = await confirmar({
                titulo: '¿Dar de baja a Brais Iglesias?',
                mensaje: 'Dejará de aparecer en la plantilla, pero se conserva su historial.',
                textoConfirmar: 'Dar de baja',
                peligrosa: true,
              })
              avisar({
                tipo: ok ? 'exito' : 'info',
                mensaje: ok ? 'Jugador dado de baja' : 'Cancelado',
              })
            }}
          >
            Confirmación
          </Boton>
          <Boton
            variante="secundario"
            onClick={() => avisar({ tipo: 'exito', mensaje: 'Asistencia guardada' })}
          >
            Aviso de éxito
          </Boton>
          <Boton
            variante="secundario"
            onClick={() =>
              avisar({ tipo: 'error', mensaje: 'No se ha podido guardar. Revisa la conexión.' })
            }
          >
            Aviso de error
          </Boton>
          <Boton
            variante="secundario"
            onClick={() =>
              avisar({
                mensaje: 'Multa borrada',
                accion: {
                  texto: 'Deshacer',
                  alPulsar: () => avisar({ tipo: 'exito', mensaje: 'Multa recuperada' }),
                },
              })
            }
          >
            Aviso con acción
          </Boton>
        </div>
      </section>

      <section className={estilos.seccion}>
        <h2>Estado vacío</h2>
        <EstadoVacio
          icono={<Users size={32} />}
          titulo="Todavía no hay jugadores"
          descripcion="Añade el primer jugador de la plantilla para empezar."
          accion={<Boton icono={<Plus aria-hidden size={18} />}>Añadir jugador</Boton>}
        />
      </section>

      <HojaInferior
        abierta={hojaAbierta}
        alCerrar={() => setHojaAbierta(false)}
        titulo="Nuevo jugador"
        pie={
          <>
            <Boton variante="secundario" onClick={() => setHojaAbierta(false)}>
              Cancelar
            </Boton>
            <Boton
              icono={<Save aria-hidden size={18} />}
              onClick={() => {
                setHojaAbierta(false)
                avisar({ tipo: 'exito', mensaje: 'Jugador añadido' })
              }}
            >
              Guardar
            </Boton>
          </>
        }
      >
        <Campo etiqueta="Nombre" required />
        <Campo etiqueta="Dorsal" inputMode="numeric" />
      </HojaInferior>
    </div>
  )
}
