/**
 * Global API Content Script
 * Receives intercepted API data from the injected interceptor
 * Runs at document_start on all Feishu pages
 */

// Store intercepted API responses
const interceptedAPIData: Array<{
  url: string
  data: any
  timestamp: number
}> = []

/**
 * Listen for intercepted API data from page context
 */
window.addEventListener('message', (event) => {
  // Only accept messages from same origin
  if (event.origin !== window.location.origin) {
    return
  }

  // Check if this is our intercepted API message
  if (event.data?.type === '__FEISHU2ALL_API_INTERCEPTED__') {
    const { url, data, timestamp } = event.data

    console.log('[Feishu2All API] Received intercepted API data:', {
      url,
      dataKeys: Object.keys(data || {}),
      timestamp,
    })

    // Store the intercepted data
    interceptedAPIData.push({
      url,
      data,
      timestamp,
    })

    // Dispatch custom event for feishu.ts to consume
    document.dispatchEvent(new CustomEvent('__feishu2all_api_data_ready__', {
      detail: {
        url,
        data,
        timestamp,
      },
    }))
  }
})

/**
 * Expose API to retrieve all intercepted data
 */
;(window as any).__feishu2all_getAPIData = function() {
  return interceptedAPIData
}

// Log when script is loaded
console.log('[Feishu2All API] Content script loaded')

// Notify background that API is ready
chrome.runtime.sendMessage({
  type: 'API_READY',
  url: window.location.href,
}).catch(() => {
  // Background might not be ready yet, ignore
})
