/**
 * Global type declarations
 */

declare global {
  interface Window {
    __FEISHU2ALL__?: {
      version: string
      ready: boolean
      extractArticle: () => void
      isSupported: () => boolean
      markReady: () => void
    }
  }

  const import: {
    meta: {
      env: {
        DEV?: boolean
        MODE?: string
        BASE_URL?: string
        PROD?: boolean
        SSR?: boolean
      }
    }
  }
}

export {}
