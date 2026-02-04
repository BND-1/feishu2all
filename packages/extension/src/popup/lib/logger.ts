/**
 * Logger utility for the extension
 * Provides debug, info, warn, and error logging with prefixes
 */

import type { Logger } from '../../types'

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class LoggerImpl implements Logger {
  private level: LogLevel = LogLevel.INFO
  private prefix = '[Feishu2All]'

  constructor() {
    // Set log level based on environment
    if (typeof import.meta.env !== 'undefined' && import.meta.env?.DEV) {
      this.level = LogLevel.DEBUG
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix
  }

  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`${this.prefix} DEBUG:`, message, ...args)
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.info(`${this.prefix} INFO:`, message, ...args)
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`${this.prefix} WARN:`, message, ...args)
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`${this.prefix} ERROR:`, message, ...args)
    }
  }

  /**
   * Create a scoped logger with a custom prefix
   */
  scoped(prefix: string): Logger {
    const scoped = new LoggerImpl()
    scoped.setLevel(this.level)
    scoped.setPrefix(`${this.prefix}:${prefix}`)
    return scoped
  }
}

// Singleton instance
export const logger = new LoggerImpl()
export default logger

/**
 * Create a scoped logger for a specific module
 */
export function createLogger(scope: string): Logger {
  return logger.scoped(scope)
}
