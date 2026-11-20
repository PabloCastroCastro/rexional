import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

// Con varios archivos de tests en paralelo, la primera pantalla de cada archivo puede tardar más del
// segundo que espera por defecto Testing Library (findBy…, waitFor) y el test falla de forma
// intermitente. Se espera hasta 4 segundos; un test que funciona termina igual de rápido. Por debajo
// de los 5 s de cada test (GH-214): si lo que se espera no llega, se ve qué faltaba en lugar de
// «Test timed out».
configure({ asyncUtilTimeout: 4000 })

// jsdom no implementa los diálogos modales: versión mínima para los tests (abre, cierra y emite
// "cancel" con Escape)
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}
