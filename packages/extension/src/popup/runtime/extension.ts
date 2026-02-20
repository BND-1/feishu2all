/**
 * Extension Runtime Interface
 * Minimal abstraction for essential Chrome extension APIs
 */

export interface Cookie {
  name: string
  value: string
  domain?: string
  path?: string
}

/**
 * Runtime interface — the contract adapters depend on.
 * ExtensionRuntime implements this for Chrome extension environment.
 * Other implementations (Node.js, test mocks) can be swapped in.
 */
export interface RuntimeInterface {
  fetch(url: string, options?: RequestInit & { timeout?: number }): Promise<Response>
  getCookies(url: string): Promise<Cookie[]>
  getStorage(keys?: string | string[] | null): Promise<Record<string, any>>
  setStorage(items: Record<string, any>): Promise<void>
  sendMessage<T = any>(message: any, tabId?: number): Promise<T>
  addHeaderRule(urlFilter: string, headers: Record<string, string>, resourceTypes?: chrome.declarativeNetRequest.ResourceType[]): Promise<number>
  removeHeaderRules(ruleIds: number[]): Promise<void>
  generateUUID(): string
}

class ExtensionRuntime implements RuntimeInterface {
  private readonly DEFAULT_TIMEOUT = 30000

  /**
   * Enhanced fetch with automatic cookie inclusion and timeout
   */
  async fetch(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const { timeout = this.DEFAULT_TIMEOUT, ...fetchOptions } = options
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        credentials: 'include',
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
   * Get items from chrome.storage.local
   */
  async getStorage(keys?: string | string[] | null): Promise<Record<string, any>> {
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
  async setStorage(items: Record<string, any>): Promise<void> {
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
   * Get the current active tab
   */
  async getCurrentTab(): Promise<chrome.tabs.Tab | undefined> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab
  }

  /**
   * Create a new tab
   */
  async createTab(url: string, active = true): Promise<chrome.tabs.Tab> {
    return chrome.tabs.create({ url, active })
  }

  /**
   * Send message to content script or background
   */
  async sendMessage<T = any>(message: any, tabId?: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const callback = (response: T) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(response)
        }
      }

      if (tabId !== undefined) {
        chrome.tabs.sendMessage(tabId, message, callback)
      } else {
        chrome.runtime.sendMessage(message, callback)
      }
    })
  }

  /**
   * Listen for messages (returns unsubscribe function)
   */
  onMessage(
    callback: (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => void | boolean
  ): () => void {
    const listener = (
      message: any,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ) => {
      return callback(message, sender, sendResponse)
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }

  // ============ Header Rules (declarativeNetRequest) ============

  private nextRuleId = 1000

  /**
   * Add a dynamic header rule via declarativeNetRequest
   * Returns a rule ID string for later removal
   */
  async addHeaderRule(
    urlFilter: string,
    headers: Record<string, string>,
    resourceTypes: chrome.declarativeNetRequest.ResourceType[] = ['xmlhttprequest']
  ): Promise<number> {
    const ruleId = this.nextRuleId++
    const requestHeaders: chrome.declarativeNetRequest.ModifyHeaderInfo[] = Object.entries(headers).map(
      ([header, value]) => ({
        header,
        operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
        value,
      })
    )

    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: ruleId,
          priority: 1,
          action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
            requestHeaders,
          },
          condition: {
            urlFilter,
            resourceTypes,
          },
        },
      ],
      removeRuleIds: [],
    })

    return ruleId
  }

  /**
   * Remove dynamic header rules by IDs
   */
  async removeHeaderRules(ruleIds: number[]): Promise<void> {
    if (ruleIds.length === 0) return
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ruleIds,
      addRules: [],
    })
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
}

// Singleton instance
export const runtime = new ExtensionRuntime()
export default runtime