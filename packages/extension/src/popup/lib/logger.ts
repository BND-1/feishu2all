/**
 * Simple logger utility
 */

import type { Logger } from '../../types'

const isDev = typeof import.meta.env !== 'undefined' && import.meta.env?.DEV

class SimpleLogger implements Logger {
  constructor(private prefix = '[Feishu2All]') {}

  debug(message: string, ...args: any[]): void {
    if (isDev) {
      console.debug(`${this.prefix} DEBUG:`, message, ...args)
    }
  }

  info(message: string, ...args: any[]): void {
    console.info(`${this.prefix} INFO:`, message, ...args)
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`${this.prefix} WARN:`, message, ...args)
  }

  error(message: string, ...args: any[]): void {
    console.error(`${this.prefix} ERROR:`, message, ...args)
  }
}

// Default logger instance
export const logger = new SimpleLogger()

/**
 * Create a logger with custom prefix
 */
export function createLogger(prefix: string): Logger {
  return new SimpleLogger(`[${prefix}]`)
}

export default logger