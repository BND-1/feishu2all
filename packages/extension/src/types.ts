/**
 * Core type definitions for the extension
 */

export interface Article {
  title: string
  markdown: string
  html?: string
  cover?: string
  summary?: string
  source?: {
    url: string
    platform: string
  }
  images?: string[]
  tags?: string[]
  categories?: string[]
}

export interface SyncResult {
  platform: string
  success: boolean
  postId?: string
  postUrl?: string
  draftOnly?: boolean
  error?: string
  timestamp: number
}

export interface AuthResult {
  isAuthenticated: boolean
  username?: string
  userId?: string
  avatar?: string
  error?: string
}

export interface PlatformConfig {
  id: string
  name: string
  icon: string
  enabled: boolean
  requireAuth: boolean
  supportMarkdown: boolean
  supportCover: boolean
  supportTags: boolean
  maxTitleLength?: number
}

export interface SyncHistory {
  id: string
  article: Article
  results: SyncResult[]
  timestamp: number
}

export interface AdapterOptions {
  onProgress?: (message: string, progress?: number) => void
  onImageProgress?: (current: number, total: number) => void
}

export interface ImageUploadResult {
  url: string
  originalUrl: string
  success: boolean
  error?: string
}

export interface PlatformCredentials {
  cookies?: Record<string, string>
  tokens?: Record<string, string>
  [key: string]: any
}

export interface Logger {
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
}

export interface MessageTypes {
  EXTRACT_ARTICLE: { url?: string }
  ARTICLE_EXTRACTED: { article: Article | null; error?: string }
  SYNC_ARTICLE: { article: Article; platforms: string[] }
  SYNC_PROGRESS: { platform: string; message: string; progress?: number }
  SYNC_COMPLETE: { results: SyncResult[] }
  CHECK_AUTH: { platform: string }
  AUTH_RESULT: { platform: string; result: AuthResult }
  GET_HISTORY: {}
  HISTORY_RESULT: { history: SyncHistory[] }
  CLEAR_HISTORY: {}
  GET_CONFIG: {}
  CONFIG_RESULT: { config: PlatformConfig[] }
  UPDATE_CONFIG: { config: PlatformConfig[] }
  OPEN_URL: { url: string }
}

export type MessageType = keyof MessageTypes
