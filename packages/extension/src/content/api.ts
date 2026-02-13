/**
 * Global API Content Script
 * Provides article extraction functionality without violating CSP
 * Runs at document_start on all Feishu pages
 */

// Instead of injecting into page context (which violates CSP),
// we create a content script-level API that can be accessed via custom events
function setupContentScriptAPI() {
  // Listen for custom events from the page (if needed in the future)
  document.addEventListener('__feishu2all_extract_article', () => {
    console.log('[Feishu2All] Extract article event received')
    chrome.runtime.sendMessage({ type: 'EXTRACT_ARTICLE_FROM_PAGE' })
  })

  console.log('[Feishu2All] Content script API ready')
}

// Setup the API at document_start
setupContentScriptAPI()

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
