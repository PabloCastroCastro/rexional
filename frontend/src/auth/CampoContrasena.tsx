import { Eye, EyeOff } from 'lucide-react'
import { type InputHTMLAttributes, useState } from 'react'
import { Campo } from '../componentes/Campo'
import estilos from './PaginaLogin.module.css'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  etiqueta: string
  autoComplete: 'current-password' | 'new-password'
}

// Contraseña con el botón de mostrarla dentro del campo, alineado con la entrada: por eso sin ayuda ni
// error debajo (van aparte, en el formulario)
export function CampoContrasena(props: Props) {
  const [ver, setVer] = useState(false)
  return (
    <div className={estilos.contrasena}>
      <Campo {...props} type={ver ? 'text' : 'password'} />
      <button
        type="button"
        className={estilos.ver}
        onClick={() => setVer((v) => !v)}
        aria-label={ver ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
        aria-pressed={ver}
      >
        {ver ? <EyeOff aria-hidden size={20} /> : <Eye aria-hidden size={20} />}
      </button>
    </div>
  )
}
