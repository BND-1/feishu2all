/**
 * API Interceptor - Injected into page context
 * Intercepts Feishu API requests to extract document data
 * Runs in MAIN world to access page's fetch/XMLHttpRequest
 */

interface FeishuDocumentData {
  title?: string
  blocks?: any[]
  content?: any
  document?: any
  [key: string]: any
}

// Store intercepted API responses
const interceptedData: Map<string, FeishuDocumentData> = new Map()

// Feishu API patterns to intercept
const API_PATTERNS = [
  /\/api\/wiki\//,
  /\/api\/docs\//,
  /\/api\/docx\//,
  /\/space\/api\/box\//,
  /\/suite\/api\/doc\//,
]

/**
 * Check if URL matches Feishu document API
 */
function isFeishuDocumentAPI(url: string): boolean {
  return API_PATTERNS.some(pattern => pattern.test(url))
}

/**
 * Intercept fetch API
 */
const originalFetch = window.fetch
window.fetch = async function(...args: Parameters<typeof fetch>): Promise<Response> {
  const url = typeof args[0] === 'string' ? args[0] : args[0].url

  // Call original fetch
  const response = await originalFetch.apply(this, args)

  // Check if this is a Feishu document API
  if (isFeishuDocumentAPI(url)) {
    console.log('[Feishu2All Interceptor] Intercepted fetch:', url)

    // Clone response to read body without consuming it
    const clonedResponse = response.clone()

    try {
      const data = await clonedResponse.json()

      // Store the data
      interceptedData.set(url, data)

      // Send to content script via postMessage
      window.postMessage({
        type: '__FEISHU2ALL_API_INTERCEPTED__',
        url,
        data,
        timestamp: Date.now(),
      }, '*')

      console.log('[Feishu2All Interceptor] Data intercepted and sent:', {
        url,
        dataKeys: Object.keys(data),
      })
    } catch (error) {
      console.warn('[Feishu2All Interceptor] Failed to parse response:', error)
    }
  }

  return response
}

/**
 * Intercept XMLHttpRequest
 */
const originalXHROpen = XMLHttpRequest.prototype.open
const originalXHRSend = XMLHttpRequest.prototype.send

XMLHttpRequest.prototype.open = function(
  method: string,
  url: string | URL,
  ...rest: any[]
) {
  // Store URL on the XHR object
  ;(this as any)._feishu2all_url = url.toString()
  return originalXHROpen.apply(this, [method, url, ...rest] as any)
}

XMLHttpRequest.prototype.send = function(...args: any[]) {
  const url = (this as any)._feishu2all_url

  if (url && isFeishuDocumentAPI(url)) {
    console.log('[Feishu2All Interceptor] Intercepted XHR:', url)

    // Listen for response
    this.addEventListener('load', function() {
      if (this.status >= 200 && this.status < 300) {
        try {
          const data = JSON.parse(this.responseText)

          // Store the data
          interceptedData.set(url, data)

          // Send to content script via postMessage
          window.postMessage({
            type: '__FEISHU2ALL_API_INTERCEPTED__',
            url,
            data,
            timestamp: Date.now(),
          }, '*')

          console.log('[Feishu2All Interceptor] XHR data intercepted and sent:', {
            url,
            dataKeys: Object.keys(data),
          })
        } catch (error) {
          console.warn('[Feishu2All Interceptor] Failed to parse XHR response:', error)
        }
      }
    })
  }

  return originalXHRSend.apply(this, args)
}

// Expose API to retrieve intercepted data
;(window as any).__feishu2all_getInterceptedData = function() {
  return Array.from(interceptedData.entries()).map(([url, data]) => ({
    url,
    data,
  }))
}

console.log('[Feishu2All Interceptor] API interceptor initialized')
