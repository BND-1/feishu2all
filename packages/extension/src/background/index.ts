/**
 * Background Service Worker
 * Handles message passing, sync orchestration, and extension lifecycle
 */

import type { Article, SyncResult, MessageTypes } from '../types'
import { CSDNAdapter } from '../popup/adapters/platforms/csdn'
import { ZhihuAdapter } from '../popup/adapters/platforms/zhihu'
import { createLogger } from '../popup/lib/logger'
import runtime from '../popup/runtime/extension'

const logger = createLogger('Background')

// Platform adapter registry
const adapters: Map<string, InstanceType<typeof CSDNAdapter> | InstanceType<typeof ZhihuAdapter>> = new Map()

/**
 * Initialize platform adapters
 */
function initializeAdapters() {
  adapters.set('csdn', new CSDNAdapter(runtime))
  adapters.set('zhihu', new ZhihuAdapter(runtime))
  logger.info('Platform adapters initialized', { count: adapters.size })
}

/**
 * Check authentication for a platform
 */
async function checkAuth(platform: string): Promise<{ isAuthenticated: boolean; username?: string; userId?: string; avatar?: string; error?: string }> {
  const adapter = adapters.get(platform)

  if (!adapter) {
    return {
      isAuthenticated: false,
      error: `Unknown platform: ${platform}`,
    }
  }

  try {
    const result = await adapter.checkAuth()
    return result
  } catch (error) {
    logger.error(`Auth check failed for ${platform}:`, error)
    return {
      isAuthenticated: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Sync article to multiple platforms
 */
async function syncArticle(article: Article, platforms: string[]): Promise<{ results: SyncResult[] }> {
  const results: SyncResult[] = []

  logger.info(`Starting sync to ${platforms.length} platforms`, {
    platforms,
    article: article.title,
  })

  for (const platformId of platforms) {
    const adapter = adapters.get(platformId)

    if (!adapter) {
      logger.warn(`Unknown platform: ${platformId}`)
      results.push({
        platform: platformId,
        success: false,
        error: `Unknown platform: ${platformId}`,
        timestamp: Date.now(),
      })
      continue
    }

    try {
      // Set up progress callbacks
      adapter.setOptions({
        onProgress: (message, progress) => {
          // Send progress update to popup
          chrome.runtime.sendMessage({
            type: 'SYNC_PROGRESS',
            platform: platformId,
            message,
            progress,
          }).catch(() => {
            // Popup might be closed, ignore error
          })
        },
        onImageProgress: (current, total) => {
          chrome.runtime.sendMessage({
            type: 'SYNC_PROGRESS',
            platform: platformId,
            message: `Uploading images ${current}/${total}`,
          }).catch(() => {
            // Popup might be closed, ignore error
          })
        },
      })

      // Publish article
      const result = await adapter.publish(article)
      results.push(result)

      logger.info(`Sync to ${platformId} completed:`, result)
    } catch (error) {
      logger.error(`Sync to ${platformId} failed:`, error)
      results.push({
        platform: platformId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      })
    }
  }

  logger.info('Sync completed', {
    total: results.length,
    success: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
  })

  return { results }
}

/**
 * Extract article from current tab
 */
async function extractArticle(url?: string): Promise<{ article: Article | null; error?: string }> {
  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (!tab.id) {
      return { article: null, error: 'No active tab found' }
    }

    logger.info('Extracting article from tab:', tab.id, tab.url)

    // Check if content script is loaded by sending a ping message first
    try {
      const pingResponse = await chrome.tabs.sendMessage(tab.id, { type: 'PING' })
      if (!pingResponse || !pingResponse.pong) {
        logger.warn('Content script did not respond to PING')
        return {
          article: null,
          error: '内容脚本未响应，请刷新页面后重试',
        }
      }
      logger.info('Content script is ready')
    } catch (pingError) {
      logger.error('PING failed:', pingError)
      return {
        article: null,
        error: '内容脚本未加载，请刷新页面后重试',
      }
    }

    // Send extraction request to content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXTRACT_ARTICLE',
      url,
    })

    if (response.error) {
      return { article: null, error: response.error }
    }

    return { article: response.article || null }
  } catch (error) {
    logger.error('Article extraction failed:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)

    // Provide helpful error messages
    if (errorMsg.includes('Receiving end does not exist') ||
        errorMsg.includes('Could not establish connection')) {
      return {
        article: null,
        error: '内容脚本未加载，请刷新页面后重试',
      }
    } else if (errorMsg.includes('message port closed')) {
      return {
        article: null,
        error: '页面连接已关闭，请重试',
      }
    }

    return {
      article: null,
      error: errorMsg,
    }
  }
}

/**
 * Handle incoming messages
 */
function handleMessage(
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
): boolean {
  logger.debug('Received message:', message.type, message)

  switch (message.type) {
    case 'CHECK_AUTH':
      checkAuth(message.platform)
        .then((result) => sendResponse({ platform: message.platform, result }))
        .catch((error) => sendResponse({ platform: message.platform, result: { isAuthenticated: false, error: error.message } }))
      return true // Async response

    case 'SYNC_ARTICLE':
      syncArticle(message.article, message.platforms)
        .then((results) => sendResponse(results))
        .catch((error) => sendResponse({ results: [{ platform: 'unknown', success: false, error: error.message, timestamp: Date.now() }] }))
      return true // Async response

    case 'EXTRACT_ARTICLE':
      extractArticle(message.url)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ article: null, error: error.message }))
      return true // Async response

    case 'SCROLL_TO_TOP':
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'SCROLL_TO_TOP' })
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ success: false, error: error.message }))
        } else {
          sendResponse({ success: false, error: 'No active tab' })
        }
      })
      return true // Async response

    case 'GET_HISTORY':
      chrome.storage.local.get('history').then((data) => {
        sendResponse({ history: data.history || [] })
      })
      return true // Async response

    case 'CLEAR_HISTORY':
      chrome.storage.local.remove('history').then(() => {
        sendResponse({ success: true })
      })
      return true // Async response

    case 'GET_CONFIG':
      chrome.storage.local.get('config').then((data) => {
        sendResponse({ config: data.config || [] })
      })
      return true // Async response

    case 'UPDATE_CONFIG':
      chrome.storage.local.set({ config: message.config }).then(() => {
        sendResponse({ success: true })
      })
      return true // Async response

    case 'OPEN_URL':
      if (message.url) {
        chrome.tabs.create({ url: message.url }).then(() => {
          sendResponse({ success: true })
        })
      } else {
        sendResponse({ success: false, error: 'No URL provided' })
      }
      return true // Async response

    case 'API_READY':
      logger.info('Content script API ready:', message.url)
      sendResponse({ success: true })
      return false // Sync response

    default:
      logger.warn('Unknown message type:', message.type)
      sendResponse({ error: `Unknown message type: ${message.type}` })
      return false
  }
}

/**
 * Initialize extension on install or update
 */
function handleInstall(details: chrome.runtime.InstalledDetails) {
  logger.info('Extension installed/updated:', details.reason)

  if (details.reason === 'install') {
    // Open welcome page or show notification
    logger.info('First install - initialization complete')
  }
}

/**
 * Service worker startup
 */
function handleStartup() {
  logger.info('Background service worker starting...')
  initializeAdapters()
}

// Event listeners
chrome.runtime.onMessage.addListener(handleMessage)
chrome.runtime.onInstalled.addListener(handleInstall)

// Handle service worker startup
handleStartup()

// Keep service worker alive for development
if (import.meta.env?.DEV) {
  logger.info('Development mode - keeping service worker alive')

  // Ping every 20 seconds to prevent idle timeout
  setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // Just a ping
    })
  }, 20000)
}

logger.info('Background service worker loaded')

// Export for testing
export { initializeAdapters, checkAuth, syncArticle, extractArticle }
