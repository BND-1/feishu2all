/**
 * Global API Content Script
 * Injects article extraction API into the page context
 * Runs at document_start on all Feishu pages
 */

// Inject the extraction API into the page context
function injectExtractionAPI() {
  const script = document.createElement('script')
  script.textContent = `
    (function() {
      // Create a global API for article extraction
      window.__FEISHU2ALL__ = {
        version: '1.0.0',
        ready: false,

        // Extract article from current page
        extractArticle: function() {
          console.log('[Feishu2All] extractArticle called from page')
          // Send message to content script
          chrome.runtime.sendMessage({ type: 'EXTRACT_ARTICLE_FROM_PAGE' })
        },

        // Check if page is supported
        isSupported: function() {
          return /https?:\\/\\/[^.]+\\.feishu\\.cn\\/(wiki|docs|docx)/.test(window.location.href)
        },

        // Mark as ready
        markReady: function() {
          this.ready = true
          console.log('[Feishu2All] API ready')
        }
      }

      console.log('[Feishu2All] API injected into page')
    })()
  `
  ;(document.head || document.documentElement).appendChild(script)
  script.remove()
}

// Inject immediately at document_start
injectExtractionAPI()

// Log when script is loaded
console.log('[Feishu2All API] Content script loaded')

// Notify background that API is ready
chrome.runtime.sendMessage({
  type: 'API_READY',
  url: window.location.href,
}).catch(() => {
  // Background might not be ready yet, ignore
})

// Listen for API_READY from page (for debugging)
document.addEventListener('__feishu2all_api_ready', () => {
  console.log('[Feishu2All API] Page API ready event received')
})
