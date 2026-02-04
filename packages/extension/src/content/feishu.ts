/**
 * Feishu Content Extractor
 * Specialized extractor for Feishu (Lark) wiki/docs/docx pages
 * This is a content script that runs on Feishu pages
 */

// Types for internal use
interface Article {
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
}

// Feishu URL patterns
const FEISHU_PATTERNS = [
  /https:\/\/[^.]+\.feishu\.cn\/wiki\//,
  /https:\/\/[^.]+\.feishu\.cn\/docs\//,
  /https:\/\/[^.]+\.feishu\.cn\/docx\//,
]

/**
 * Check if current URL is a Feishu document
 */
function isFeishuPage(): boolean {
  const url = window.location.href
  return FEISHU_PATTERNS.some((pattern) => pattern.test(url))
}

/**
 * Get Feishu document type from URL
 */
function getFeishuDocType(): 'wiki' | 'docs' | 'docx' | null {
  const url = window.location.href

  if (/\/wiki\//.test(url)) return 'wiki'
  if (/\/docs\//.test(url)) return 'docs'
  if (/\/docx\//.test(url)) return 'docx'

  return null
}

/**
 * Feishu-specific selectors - Updated for current Feishu DOM structure
 */
const FEISHU_SELECTORS = {
  // Title selectors
  title: [
    '[class*="title-input"]',
    '[class*="doc-title"]',
    '[class*="wiki-title"]',
    '[data-test-id="wiki-title"]',
    '[data-test-id="doc-title"]',
    '[class*="Title"]',
    '.doc-title',
    '.wiki-title',
    'h1',
  ],

  // Main content area - be more specific to avoid getting the entire page
  mainContent: [
    '[class*="doc-content"]',
    '[class*="wiki-content"]',
    '[class*="docx-content"]',
    '[class*="rich-text"]',
    '[class*="slate-editor"]',
    '[class*="editor-container"]',
    '[class*="EditorContainer"]',
    '[class*="lark-editor"]',
    '[data-content-editable-root]',
    '[contenteditable="true"]',
    '.wiki-content',
    '.doc-content',
  ],

  // Article wrapper - more comprehensive selectors
  articleWrapper: [
    '#mainBox',
    '#opcr',
    '[class*="render-unit-wrapper"]',
    '[class*="doc-content-container"]',
    '[class*="wiki-content-container"]',
    '[class*="docx-editor"]',
    '[class*="doc-reader"]',
    '[class*="wiki-reader"]',
    '[class*="lark-doc"]',
    '[class*="doc-container"]',
    '[class*="wiki-container"]',
    '[class*="wiki-popover-container"]',
    '[class*="article-container"]',
    '[class*="page-content"]',
    '[class*="main-content"]',
    '[id*="magicEditor"]',
    '[id*="render"]',
    '#ARTICLE',
    'article',
    'main',
    '[role="main"]',
    '#main',
  ],

  // Cover image selectors
  cover: [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
  ],
}

/**
 * Query multiple selectors and return first match
 */
function queryFirst(selectors: string[], root: Element | Document = document): Element | null {
  for (const selector of selectors) {
    const element = root.querySelector(selector)
    if (element) {
      return element
    }
  }
  return null
}

/**
 * Get text content from multiple selectors
 */
function getTextContent(selectors: string[], root: Element | Document = document): string {
  const element = queryFirst(selectors, root)
  if (!element) {
    return ''
  }

  // For meta elements, get content attribute
  if (element instanceof HTMLMetaElement) {
    return element.getAttribute('content') || ''
  }

  return element.textContent?.trim() || ''
}

/**
 * Convert HTML to Markdown (simplified version)
 */
function htmlToMarkdown(html: string): string {
  let markdown = html

  // Headers
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')

  // Bold
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')

  // Italic
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '_$1_')
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '_$1_')

  // Code blocks
  markdown = markdown.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n\n')
  markdown = markdown.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n\n')

  // Inline code
  markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')

  // Links
  markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')

  // Images
  markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*(?:alt="([^"]*)")?[^>]*>/gi, '![$2]($1)')

  // Line breaks and paragraphs
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n')
  markdown = markdown.replace(/<\/p>\s*<p>/gi, '\n\n')
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')

  // Lists
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1')
  markdown = markdown.replace(/<\/?ul[^>]*>/gi, '')
  markdown = markdown.replace(/<\/?ol[^>]*>/gi, '')

  // Blockquotes
  markdown = markdown.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n\n')

  // Tables (basic support)
  markdown = markdown.replace(/<table[^>]*>/gi, '\n')
  markdown = markdown.replace(/<\/table[^>]*>/gi, '\n')
  markdown = markdown.replace(/<tr[^>]*>/gi, '|')
  markdown = markdown.replace(/<\/tr>/gi, '|\n')
  markdown = markdown.replace(/<t[dh][^>]*>/gi, '|')
  markdown = markdown.replace(/<\/t[dh]>/gi, '')

  // Clean up extra whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n')

  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]+>/g, '')

  // Decode HTML entities
  markdown = markdown.replace(/&nbsp;/g, ' ')
  markdown = markdown.replace(/&lt;/g, '<')
  markdown = markdown.replace(/&gt;/g, '>')
  markdown = markdown.replace(/&amp;/g, '&')
  markdown = markdown.replace(/&quot;/g, '"')
  markdown = markdown.replace(/&#39;/g, "'")

  return markdown.trim()
}

/**
 * Clean HTML by removing unwanted elements
 */
function cleanHtml(html: string): string {
  let cleaned = html

  // Remove script and style tags
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')

  return cleaned.trim()
}

/**
 * Process images - handle lazy loading
 */
function processImages(html: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  const images = tempDiv.querySelectorAll('img')

  images.forEach((img) => {
    // Check for lazy loading attributes
    const dataSrc =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src')

    if (dataSrc && !img.getAttribute('src')) {
      img.setAttribute('src', dataSrc)
    }
  })

  return tempDiv.innerHTML
}

/**
 * Process code blocks
 */
function processCodeBlocks(html: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  const codeBlocks = tempDiv.querySelectorAll('pre code, pre[class*="code"]')

  codeBlocks.forEach((block) => {
    const pre = block.parentElement as HTMLElement

    // Try to detect language
    let language = ''
    const classList = block.className.split(' ')

    for (const cls of classList) {
      const match = cls.match(/(?:language-|lang-)(\w+)/)
      if (match) {
        language = match[1]
        break
      }
    }

    if (language) {
      pre.setAttribute('data-language', language)
    }
  })

  return tempDiv.innerHTML
}

/**
 * Extract image URLs from HTML
 */
function extractImagesFromHtml(html: string): string[] {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  const images: string[] = []
  const imgElements = tempDiv.querySelectorAll('img')

  imgElements.forEach((img) => {
    const src = img.getAttribute('src')
    if (src && (src.startsWith('http') || src.startsWith('data:image'))) {
      images.push(src)
    }
  })

  return [...new Set(images)]
}

/**
 * Extract article from Feishu page
 */
function extractFeishuArticle(): Article | null {
  try {
    console.log('[FeishuExtractor] Starting extraction...')

    if (!isFeishuPage()) {
      console.warn('[FeishuExtractor] Not a Feishu page')
      return null
    }

    const docType = getFeishuDocType()
    console.log(`[FeishuExtractor] Extracting from Feishu ${docType} page`)

    // Get title - try multiple approaches
    let title = getTextContent(FEISHU_SELECTORS.title)

    // Fallback: try to get title from page title
    if (!title || title === 'Docs') {
      const pageTitle = document.title
      // Remove common suffixes
      title = pageTitle
        .replace(/\s*-\s*飞书.*/, '')
        .replace(/\s*-\s*Lark.*/, '')
        .replace(/\s*-\s*飞书文档.*/, '')
        .replace('Docs', '')
        .trim()
    }

    if (!title) {
      console.warn('[FeishuExtractor] Could not extract title')
      title = 'Untitled Feishu Document'
    }

    console.log('[FeishuExtractor] Title:', title)

    // Debug: Log available DOM elements
    console.log('[FeishuExtractor] Checking for article wrapper...')
    console.log('[FeishuExtractor] Document ready state:', document.readyState)
    console.log('[FeishuExtractor] Body exists:', !!document.body)

    // Debug: Log all class names containing common keywords for debugging
    const allElements = document.querySelectorAll('[class]')
    const relevantClasses: string[] = []
    allElements.forEach((el) => {
      const className = el.className
      if (typeof className === 'string' &&
          (className.includes('content') || className.includes('doc') ||
           className.includes('editor') || className.includes('article') ||
           className.includes('render') || className.includes('wiki'))) {
        relevantClasses.push(className.split(' ')[0])
      }
    })
    console.log('[FeishuExtractor] Relevant class names found:', [...new Set(relevantClasses)].slice(0, 20))

    // Debug: Try each selector individually
    for (const selector of FEISHU_SELECTORS.articleWrapper) {
      const el = document.querySelector(selector)
      if (el) {
        console.log(`[FeishuExtractor] Found wrapper with selector "${selector}":`, el.className)
      }
    }

    // Find the main content wrapper first
    let articleWrapper = queryFirst(FEISHU_SELECTORS.articleWrapper)

    // Fallback: try to find content directly
    if (!articleWrapper) {
      console.log('[FeishuExtractor] Trying mainContent selectors directly...')
      articleWrapper = queryFirst(FEISHU_SELECTORS.mainContent)
    }

    // Fallback: use body if nothing else works but we're on a valid feishu page
    if (!articleWrapper) {
      console.warn('[FeishuExtractor] Could not find article wrapper, using body as fallback')
      console.warn('[FeishuExtractor] Tried selectors:', FEISHU_SELECTORS.articleWrapper)
      articleWrapper = document.body
    }

    console.log('[FeishuExtractor] Found article wrapper:', articleWrapper.className || 'body')

    // Get main content from within the wrapper
    let contentElement = queryFirst(FEISHU_SELECTORS.mainContent, articleWrapper)

    // If not found in wrapper, try document-wide
    if (!contentElement && articleWrapper !== document.body) {
      console.log('[FeishuExtractor] Trying mainContent selectors on document...')
      contentElement = queryFirst(FEISHU_SELECTORS.mainContent, document)
    }

    if (!contentElement) {
      console.warn('[FeishuExtractor] Could not find main content element')
      // Try to use the wrapper itself as content
      console.log('[FeishuExtractor] Using article wrapper as content')
    }

    // Get HTML content
    let html = contentElement ? contentElement.innerHTML : articleWrapper.innerHTML

    console.log('[FeishuExtractor] HTML length before cleaning:', html.length)

    // Clean and process HTML
    html = processImages(html)
    html = processCodeBlocks(html)
    html = cleanHtml(html)

    console.log('[FeishuExtractor] HTML length after cleaning:', html.length)

    // Convert to markdown
    const markdown = htmlToMarkdown(html)

    console.log('[FeishuExtractor] Markdown length:', markdown.length)
    console.log('[FeishuExtractor] Markdown preview:', markdown.substring(0, 200) + '...')

    // Get cover image
    let cover: string | undefined
    const coverMeta = document.querySelector('meta[property="og:image"]')
    if (coverMeta) {
      cover = coverMeta.getAttribute('content') || undefined
    }

    // Get description from meta
    const descriptionMeta = document.querySelector('meta[property="og:description"], meta[name="description"]')
    const description = descriptionMeta?.getAttribute('content') || undefined

    // Extract images
    const images = extractImagesFromHtml(html)

    // Build article object
    const article: Article = {
      title,
      markdown,
      html,
      cover,
      summary: description,
      source: {
        url: window.location.href,
        platform: 'feishu',
      },
    }

    if (images.length > 0) {
      article.images = images
    }

    console.log(`[FeishuExtractor] Successfully extracted article: ${title}`)
    console.log('[FeishuExtractor] Image count:', images.length)

    return article
  } catch (error) {
    console.error('[FeishuExtractor] Extraction failed:', error)
    return null
  }
}

/**
 * Initialize the content script
 */
function initializeContentScript() {
  // Log when script is loaded
  console.log('[FeishuExtractor] Feishu content script loaded')
  console.log('[FeishuExtractor] URL:', window.location.href)
  console.log('[FeishuExtractor] Is Feishu page:', isFeishuPage())

  // Auto-extract for debugging (optional)
  if (isFeishuPage() && document.readyState === 'complete') {
    console.log('[FeishuExtractor] Page loaded, ready for extraction')
  }

  /**
   * Listen for extraction requests from background/popup
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[FeishuExtractor] Received message:', message.type, message)

    if (message.type === 'EXTRACT_ARTICLE') {
      console.log('[FeishuExtractor] Extracting article...')

      // Use setTimeout to allow async response
      setTimeout(() => {
        try {
          const article = extractFeishuArticle()

          if (article) {
            console.log('[FeishuExtractor] Sending article:', article)
            sendResponse({ article, error: null })
          } else {
            console.error('[FeishuExtractor] Failed to extract article')
            sendResponse({
              article: null,
              error: 'Could not extract article. Make sure you are on a Feishu wiki/docs/docx page.',
            })
          }
        } catch (error) {
          console.error('[FeishuExtractor] Extraction error:', error)
          sendResponse({
            article: null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }, 100)

      return true // Keep message channel open for async response
    }

    // Handle PING message
    if (message.type === 'PING') {
      sendResponse({ pong: true })
      return true
    }

    return false
  })
}

// Execute initialization immediately when script loads
initializeContentScript()
