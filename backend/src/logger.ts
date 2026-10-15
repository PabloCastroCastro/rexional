import pino from 'pino'
import { config } from './config.js'

// Logs en JSON (un objeto por línea) para el servidor; legibles con pino-pretty en desarrollo
export const logger = pino({
  level: config.nivelLog,
  base: { entorno: config.entorno },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(config.entorno === 'desarrollo' && {
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,entorno' },
    },
  }),
})
