// Base de datos de los tests: TEST_DATABASE_URL o, si no existe, DATABASE_URL (así en la CI).
// Los tests borran y crean datos, así que se niegan a usar una base que no termine en _test.
export function urlDeTest(env: Record<string, string | undefined> = process.env): string {
  const url = env.TEST_DATABASE_URL ?? env.DATABASE_URL
  if (!url) {
    throw new Error('Define TEST_DATABASE_URL (o DATABASE_URL) con la base de datos de los tests')
  }
  const nombre = nombreBaseDeDatos(url)
  if (!nombre.endsWith('_test')) {
    throw new Error(
      `Los tests modifican datos: la base de datos debe terminar en _test y es "${nombre}"`,
    )
  }
  return url
}

export const nombreBaseDeDatos = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1))
