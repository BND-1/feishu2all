/**
 * Extension Runtime Interface
 * Abstraction layer for Chrome extension APIs
 */

interface FetchOptions extends RequestInit {
  timeout?: number
  initiator?: string
}

interface Cookie {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
}

interface StorageItems {
  [key: string]: any
}

interface TabInfo {
  id?: number
  url?: string
  title?: string
  active?: boolean
}

interface HeaderRule {
  ruleId: string
  initiatorDomains?: string[]
  requestHeaders?: { header: string; operation: 'set' | 'remove'; value?: string }[]
  responseHeaders?: { header: string; operation: 'set' | 'remove'; value?: string }[]
}

class ExtensionRuntime {
  private readonly DEFAULT_TIMEOUT = 30000

  /**
   * Enhanced fetch with automatic cookie inclusion and timeout protection
   */
  async fetch(url: string | URL, options: FetchOptions = {}): Promise<Response> {
    const { timeout = this.DEFAULT_TIMEOUT, ...fetchOptions } = options

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        credentials: 'include', // Include cookies
      })
      clearTimeout(timeoutId)
      return response
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`)
      }
      throw error
    }
  }

  /**
   * Fetch JSON response with automatic parsing
   */
  async fetchJSON<T = any>(url: string | URL, options: FetchOptions = {}): Promise<T> {
    const response = await this.fetch(url, options)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response.json() as Promise<T>
  }

  /**
   * Get cookies for a specific URL
   */
  async getCookies(url: string): Promise<Cookie[]> {
    return new Promise((resolve, reject) => {
      chrome.cookies.getAll({ url }, (cookies) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(cookies || [])
        }
      })
    })
  }

  /**
   * Get a specific cookie by name
   */
  async getCookie(url: string, name: string): Promise<Cookie | undefined> {
    return new Promise((resolve, reject) => {
      chrome.cookies.get({ url, name }, (cookie) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(cookie || undefined)
        }
      })
    })
  }

  /**
   * Set a cookie
   */
  async setCookie(cookie: Cookie): Promise<Cookie | null> {
    return new Promise((resolve, reject) => {
      chrome.cookies.set(cookie, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(result || null)
        }
      })
    })
  }

  /**
   * Remove a cookie
   */
  async removeCookie(url: string, name: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      chrome.cookies.remove({ url, name }, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(result !== null)
        }
      })
    })
  }

  /**
   * Get items from chrome.storage.local
   */
  async getStorage(keys?: string | string[] | null): Promise<StorageItems> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys || null, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(result || {})
        }
      })
    })
  }

  /**
   * Set items in chrome.storage.local
   */
  async setStorage(items: StorageItems): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * Remove items from chrome.storage.local
   */
  async removeStorage(keys: string | string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * Get items from chrome.storage.session
   */
  async getSession(keys?: string | string[] | null): Promise<StorageItems> {
    return new Promise((resolve, reject) => {
      chrome.storage.session.get(keys || null, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(result || {})
        }
      })
    })
  }

  /**
   * Set items in chrome.storage.session
   */
  async setSession(items: StorageItems): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.session.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * Query tabs with optional filters
   */
  async queryTabs(queryInfo: chrome.tabs.QueryInfo = {}): Promise<TabInfo[]> {
    return new Promise((resolve, reject) => {
      chrome.tabs.query(queryInfo, (tabs) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(
            tabs.map((tab) => ({
              id: tab.id,
              url: tab.url,
              title: tab.title,
              active: tab.active,
            }))
          )
        }
      })
    })
  }

  /**
   * Get the current active tab
   */
  async getCurrentTab(): Promise<TabInfo | undefined> {
    const tabs = await this.queryTabs({ active: true, currentWindow: true })
    return tabs[0]
  }

  /**
   * Create a new tab
   */
  async createTab(options: { url: string; active?: boolean }): Promise<TabInfo> {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(options, (tab) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve({
            id: tab.id,
            url: tab.url,
            title: tab.title,
            active: tab.active,
          })
        }
      })
    })
  }

  /**
   * Wait for a tab to finish loading
   */
  async waitForTabLoad(tabId: number, timeout = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          resolve()
        }
      }

      chrome.tabs.onUpdated.addListener(listener)

      // Also check current status
      chrome.tabs.get(tabId, (tab) => {
        if (tab.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          resolve()
        }
      })

      // Timeout protection
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener)
        reject(new Error('Tab load timeout'))
      }, timeout)
    })
  }

  /**
   * Execute script in a tab
   */
  async executeScript(tabId: number, func: () => any): Promise<any> {
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          func,
        },
        (results) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError)
          } else {
            resolve(results?.[0]?.result)
          }
        }
      )
    })
  }

  /**
   * Send message to content script
   */
  async sendMessage<T = any>(
    message: any,
    options?: { tabId?: number }
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const callback = (response: T) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(response)
        }
      }

      if (options?.tabId !== undefined) {
        chrome.tabs.sendMessage(options.tabId, message, callback)
      } else {
        chrome.runtime.sendMessage(message, callback)
      }
    })
  }

  /**
   * Send message to background script
   */
  async sendToBackground<T = any>(message: any): Promise<T> {
    return this.sendMessage<T>(message)
  }

  /**
   * Listen for messages (returns unsubscribe function)
   */
  onMessage(
    callback: (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => void
  ): () => void {
    const listener = (
      message: any,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ) => {
      callback(message, sender, sendResponse)
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }

  /**
   * Parse HTML and query with selectors
   */
  parseHTML(html: string): Document {
    const parser = new DOMParser()
    return parser.parseFromString(html, 'text/html')
  }

  /**
   * Query elements from parsed HTML document
  */
  querySelectorAll(doc: Document, selector: string): Element[] {
    return Array.from(doc.querySelectorAll(selector))
  }

  /**
   * Query single element from parsed HTML document
   */
  querySelector(doc: Document, selector: string): Element | null {
    return doc.querySelector(selector)
  }

  /**
   * Generate HMAC signature using Web Crypto API
   */
  async hmacSha256(message: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const messageData = encoder.encode(message)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Generate HMAC-SHA1 signature (for Zhihu OSS)
   */
  async hmacSha1(message: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const messageData = encoder.encode(message)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Generate MD5 hash
   */
  async md5(message: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(message)
    const hashBuffer = await crypto.subtle.digest('MD5', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Generate UUID v4
   */
  generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  /**
   * Convert Blob to base64
   */
  async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  /**
   * Convert base64 to Blob
   */
  base64ToBlob(base64: string, mimeType = 'image/jpeg'): Blob {
    const byteCharacters = atob(base64.split(',')[1])
    const byteArrays: Uint8Array[] = []
    const sliceSize = 512

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize)
      const byteNumbers = new Array(slice.length)
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i)
      }
      byteArrays.push(new Uint8Array(byteNumbers))
    }

    return new Blob(byteArrays, { type: mimeType })
  }

  /**
   * Download a file as Blob
   */
  async downloadBlob(url: string): Promise<Blob> {
    const response = await this.fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`)
    }
    return response.blob()
  }

  /**
   * Get browser locale
   */
  getLocale(): string {
    return chrome.i18n.getUILanguage() || 'en-US'
  }
}

// Singleton instance
export const runtime = new ExtensionRuntime()
export default runtime
