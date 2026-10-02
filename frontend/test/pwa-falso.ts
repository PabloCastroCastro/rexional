// Sustituto de virtual:pwa-register/react en los tests (el módulo solo existe al compilar)
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as const,
    offlineReady: [false, () => {}] as const,
    updateServiceWorker: async () => {},
  }
}
