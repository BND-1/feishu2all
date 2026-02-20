/**
 * Feishu Content Extractor (DOM-based)
 * Extracts article content from Feishu (Lark) wiki/docs/docx pages
 *
 * Strategy:
 * - Direct DOM extraction with virtual scrolling support
 * - Collects all content blocks by scrolling and observing DOM changes
 */

const LOG_PREFIX = '[FeishuExtractor]'
const DEBUG = false // Set to true for verbose logging

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args)
}

function debug(...args: unknown[]) {
  if (DEBUG) console.log(LOG_PREFIX, ...args)
}

function warn(...args: unknown[]) {
  console.warn(LOG_PREFIX, ...args)
}

function error(...args: unknown[]) {
  console.error(LOG_PREFIX, ...args)
}

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
  imageDataMap?: Record<string, string>
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
 * Decode HTML entities in URL
 */
function decodeHtmlEntities(url: string): string {
  return url
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/**
 * Process lazy-loaded images
 * Feishu uses data-src for lazy loading
 */
function processLazyImages(container: HTMLElement): void {
  const images = container.querySelectorAll('img')

  images.forEach((img) => {
    // Find real image URL from various lazy-load attributes
    let realSrc =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-actualsrc') ||
      img.getAttribute('_src') ||
      img.src

    // Decode HTML entities in URL
    if (realSrc) {
      realSrc = decodeHtmlEntities(realSrc)
    }

    // Skip data URLs (SVG placeholders)
    if (realSrc && !realSrc.startsWith('data:image/svg')) {
      img.setAttribute('src', realSrc)
    }

    // Clean up lazy-load attributes
    img.removeAttribute('data-src')
    img.removeAttribute('data-original')
    img.removeAttribute('data-actualsrc')
    img.removeAttribute('_src')
    img.removeAttribute('data-ratio')
    img.removeAttribute('data-w')
    img.removeAttribute('data-type')
    img.removeAttribute('data-s')
  })
}

/**
 * Extract images from container
 */
function extractImages(container: HTMLElement): string[] {
  const images: string[] = []
  const imgElements = container.querySelectorAll('img')

  imgElements.forEach((img) => {
    let src = img.src
    // Decode HTML entities
    if (src) {
      src = decodeHtmlEntities(src)
    }
    if (src && !src.startsWith('data:') && !images.includes(src)) {
      images.push(src)
    }
  })

  return images
}

/**
 * Download images and convert to data URLs
 * Pre-downloads images in content script context (has Feishu CDN cookies)
 */
async function downloadImages(imageUrls: string[]): Promise<Record<string, string>> {
  const imageDataMap: Record<string, string> = {}

  if (imageUrls.length === 0) return imageDataMap

  log(`Pre-downloading ${imageUrls.length} images...`)

  for (const imgUrl of imageUrls) {
    try {
      debug(`Downloading: ${imgUrl}`)
      const resp = await fetch(imgUrl, { credentials: 'include' })

      if (!resp.ok) {
        error(`Download failed (${resp.status} ${resp.statusText}): ${imgUrl}`)
        continue
      }

      const blob = await resp.blob()

      if (blob.size === 0) {
        error(`Downloaded blob is empty: ${imgUrl}`)
        continue
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('FileReader error'))
        reader.readAsDataURL(blob)
      })

      imageDataMap[imgUrl] = dataUrl
      debug(`Downloaded (${blob.size} bytes): ${imgUrl.substring(0, 80)}...`)
    } catch (err) {
      error(`Download error: ${imgUrl}`, err)
    }
  }

  log(`Downloaded ${Object.keys(imageDataMap).length}/${imageUrls.length} images`)

  const failed = imageUrls.filter(url => !imageDataMap[url])
  if (failed.length > 0) {
    warn(`Failed to download ${failed.length} images`)
  }

  return imageDataMap
}

/**
 * Preprocess HTML to normalize Feishu-specific structures
 * Converts Feishu's custom block types to standard HTML tags
 */
function preprocessFeishuHtml(html: string): string {
  let result = html

  // Convert Feishu heading blocks to standard HTML headings
  // <div data-block-type="heading1">text</div> → <h1>text</h1>
  for (let level = 1; level <= 9; level++) {
    const regex = new RegExp(
      `<div([^>]*data-block-type=["']heading${level}["'][^>]*)>([\\s\\S]*?)</div>`,
      'gi'
    )
    const headingLevel = Math.min(level, 6) // Markdown only supports h1-h6

    // Use function replacement to trim whitespace from captured content
    result = result.replace(regex, (match, attrs, content) => {
      const trimmedContent = content.trim()
      return `<h${headingLevel}>${trimmedContent}</h${headingLevel}>`
    })
  }

  // Remove HTML comments
  result = result.replace(/<!--[\s\S]*?-->/g, '')

  // Remove data-* attributes (Feishu-specific metadata)
  result = result.replace(/\s*data-[\w-]+=(["'])[^"']*\1/gi, '')

  // Remove empty paragraphs and divs
  result = result.replace(/<(p|div)[^>]*>\s*<\/\1>/gi, '')

  // Remove trailing <br> tags before closing tags
  result = result.replace(/(<br\s*\/?>)+(<\/(p|div|section)>)/gi, '$2')

  // Collapse multiple newlines
  result = result.replace(/\n{3,}/g, '\n\n')

  return result
}

/**
 * Convert HTML to Markdown using custom regex-based converter
 * Based on Wechatsync's implementation to avoid Turndown's aggressive escaping
 */
function htmlToMarkdown(html: string): string {
  // Preprocess HTML to normalize Feishu-specific structures
  const preprocessedHtml = preprocessFeishuHtml(html)

  let md = preprocessedHtml

  // Remove div/br tags inside headings (Feishu sometimes wraps heading text in divs)
  md = md.replace(/<(h[1-6][^>]*)>([\s\S]*?)<\/h[1-6]>/gi, (match, openTag, content) => {
    // Remove div and br tags inside heading, keep text only
    const cleanContent = content
      .replace(/<div[^>]*>/gi, '')
      .replace(/<\/div>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return `<${openTag}>${cleanContent}</h${openTag.match(/h([1-6])/)?.[1] || '2'}>`
  })

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n')
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n')

  // Bold and italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')

  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')

  // Images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)')

  // Code blocks
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, content) => {
    let language = ''

    // Extract language from pre tag
    const preLangMatch = match.match(/<pre[^>]*data-lang(?:uage)?=["'](\w+)["']/)
    const preClassMatch = match.match(/<pre[^>]*class="([^"]*)"/)
    if (preLangMatch) {
      language = preLangMatch[1]
    } else if (preClassMatch) {
      const langMatch = preClassMatch[1].match(/(?:language-|lang-)(\w+)/)
      if (langMatch) language = langMatch[1]
    }

    // Extract language from code tag
    const codeLangMatch = content.match(/<code[^>]*data-lang(?:uage)?=["'](\w+)["']/)
    const codeClassMatch = content.match(/<code[^>]*class="([^"]*)"/)
    if (!language) {
      if (codeLangMatch) {
        language = codeLangMatch[1]
      } else if (codeClassMatch) {
        const langMatch = codeClassMatch[1].match(/(?:language-|lang-)(\w+)/)
        if (langMatch) language = langMatch[1]
      }
    }

    // Extract text content
    let text = content
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '$1')
      .replace(/<[^>]+>/g, '')

    // Decode HTML entities
    text = text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")

    return '\n```' + language + '\n' + text.trim() + '\n```\n'
  })

  // Inline code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')

  // Lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '$1\n')
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '$1\n')
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')

  // Paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
  md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '\n$1\n')  // Feishu uses div for paragraphs
  md = md.replace(/<br\s*\/?>/gi, '\n')
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n')

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    return '\n' + content.trim().split('\n').map((line: string) => '> ' + line).join('\n') + '\n'
  })

  // Remove other tags
  md = md.replace(/<\/?[^>]+(>|$)/g, '')

  // Decode HTML entities
  md = md.replace(/&amp;/g, '&')
  md = md.replace(/&lt;/g, '<')
  md = md.replace(/&gt;/g, '>')
  md = md.replace(/&quot;/g, '"')
  md = md.replace(/&#039;/g, "'")
  md = md.replace(/&nbsp;/g, ' ')

  // Clean up extra blank lines
  md = md.replace(/\n{3,}/g, '\n\n')
  md = md.trim()

  return md
}

/**
 * Collect all content blocks by scrolling and observing DOM changes
 * Based on: https://greasyfork.org/scripts/470055
 */
async function collectAllContentBlocks(): Promise<DocumentFragment | null> {
  debug('Collecting all content blocks...')

  const scrollContainer = document.querySelector('.bear-web-x-container') as HTMLElement

  // Find the correct render-unit-wrapper (not inside AI summary block)
  const allWrappers = document.querySelectorAll('.render-unit-wrapper')
  let contentContainer: HTMLElement | null = null

  for (const wrapper of Array.from(allWrappers)) {
    // Skip if inside AI summary block
    if (wrapper.closest('.docx-ai-summary-block')) {
      debug('Skipping render-unit-wrapper inside AI summary')
      continue
    }
    // Skip if inside back-ref list
    if (wrapper.closest('.docx-back_ref_list-block')) {
      debug('Skipping render-unit-wrapper inside back-ref list')
      continue
    }
    // This should be the main content wrapper
    contentContainer = wrapper as HTMLElement
    debug('Found main content render-unit-wrapper')
    break
  }

  if (!scrollContainer || !contentContainer) {
    warn('Could not find Feishu containers')
    return null
  }

  debug('Found Feishu containers')

  const fragment = document.createDocumentFragment()
  const collectedIds = new Set<string>()

  // Collect existing nodes
  function collectNodes(nodes: NodeList) {
    for (const node of Array.from(nodes)) {
      const el = node as HTMLElement
      if (el.hasAttribute && el.hasAttribute('data-block-id')) {
        // Skip empty blocks
        if (el.classList.contains('isEmpty')) {
          continue
        }

        // Skip Feishu AI summary blocks (auto-generated content)
        // Most reliable way: check for DOC_AI_SUMMARY_ROOT_BLOCK_ID
        const recordId = el.getAttribute('data-record-id')
        if (recordId === 'DOC_AI_SUMMARY_ROOT_BLOCK_ID') {
          debug('Skipping AI summary block (data-record-id)')
          continue
        }

        // Also check for AI summary related classes
        const classList = el.className || ''
        if (classList.includes('docx-ai-summary-block')) {
          debug('Skipping AI summary block (class)')
          continue
        }

        // Check descendants for AI summary classes
        const aiSummarySelectors = [
          '.docx-ai-summary-block-inner',
          '.docx-ai-summary-block-inner-v2',
          '.docx-ai-summary-block-inner-v2-isFold',
        ]

        let hasAISummaryChild = false
        for (const selector of aiSummarySelectors) {
          if (el.querySelector && el.querySelector(selector)) {
            hasAISummaryChild = true
            break
          }
        }

        if (hasAISummaryChild) {
          debug('Skipping block with AI summary child')
          continue
        }

        // Skip blocks with print-forbidden placeholders (attachments, restricted content)
        // But allow image blocks even if they have the placeholder (might be loading state)
        const hasForbiddenPlaceholder = el.querySelector && el.querySelector('.gpf-biz-action-manager-forbidden-placeholder')
        const isImageBlock = el.querySelector && el.querySelector('img')

        if (hasForbiddenPlaceholder && !isImageBlock) {
          debug('Skipping block with forbidden placeholder (restricted content)')
          continue
        }

        const blockId = el.getAttribute('data-block-id')
        if (blockId && !collectedIds.has(blockId)) {
          const cloned = el.cloneNode(true) as HTMLElement
          // Remove forbidden placeholder text from cloned node (e.g. "附件不支持打印")
          if (hasForbiddenPlaceholder && cloned.querySelectorAll) {
            cloned.querySelectorAll('.gpf-biz-action-manager-forbidden-placeholder').forEach(p => p.remove())
          }
          fragment.appendChild(cloned)
          collectedIds.add(blockId)
        }
      }
    }
  }

  // Collect initial content
  collectNodes(contentContainer.childNodes)
  debug(`Initial blocks collected: ${collectedIds.size}`)

  // Set up observer for new content
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        setTimeout(() => {
          collectNodes(mutation.addedNodes)
        }, 100)
      }
    }
  })

  observer.observe(contentContainer, { childList: true })

  // Auto-scroll to trigger content loading
  const scrollGap = 300
  const scrollInterval = 200
  let lastScrollTop = -1
  let stableCount = 0

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (scrollContainer.scrollTop === lastScrollTop) {
        stableCount++
        if (stableCount >= 3) {
          // Stable for 3 checks, we're done
          clearInterval(interval)
          observer.disconnect()
          resolve()
        }
      } else {
        stableCount = 0
        lastScrollTop = scrollContainer.scrollTop
        scrollContainer.scrollBy(0, scrollGap)
      }
    }, scrollInterval)
  })

  log(`Collection complete, total blocks: ${collectedIds.size}`)
  return fragment
}

/**
 * Extract article from Feishu page (DOM-based)
 */
async function extractFeishuArticle(): Promise<Article | null> {
  try {
    debug('Starting DOM-based extraction...')

    if (!isFeishuPage()) {
      warn('Not a Feishu page')
      return null
    }

    // Use DOM extraction
    return await extractFromDOM()
  } catch (err) {
    error('Extraction failed:', err)
    throw err
  }
}

/**
 * Extract from DOM (fallback, may be incomplete)
 */
async function extractFromDOM(): Promise<Article | null> {
  try {
    debug('Starting DOM-based extraction...')

    // Try to collect all content blocks (handles virtual scrolling)
    const fragment = await collectAllContentBlocks()
    let contentContainer: HTMLElement | DocumentFragment | null = fragment

    if (!contentContainer) {
      warn('Could not collect content blocks, trying standard selectors...')

      // Fallback to standard selectors
      const selectors = [
        '.doc-render',
        '.wiki-render',
        '.docs-reader',
        '[class*="render"]',
        'article',
        'main',
      ]

      for (const selector of selectors) {
        const el = document.querySelector(selector) as HTMLElement
        if (el && el.textContent && el.textContent.trim().length > 100) {
          contentContainer = el
          debug(`Found content with selector: ${selector}`)
          break
        }
      }
    }

    if (!contentContainer) {
      throw new Error('无法找到文档内容区域')
    }

    // Extract title
    let title = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
    if (!title) {
      title = document.title.split(' - ')[0].trim()
    }
    if (!title) {
      title = 'Untitled Document'
    }
    debug(`Title: ${title}`)

    // Clone content to avoid modifying the page
    let clonedContent: HTMLElement
    if (contentContainer instanceof DocumentFragment) {
      // Create a temporary container for the fragment
      clonedContent = document.createElement('div')
      clonedContent.appendChild(contentContainer.cloneNode(true))
    } else {
      clonedContent = contentContainer.cloneNode(true) as HTMLElement
    }

    // Process lazy-loaded images
    processLazyImages(clonedContent)

    // Extract images
    const images = extractImages(clonedContent)
    debug(`Found ${images.length} images`)

    // Get HTML content
    const html = clonedContent.innerHTML

    // Convert to Markdown
    const markdown = htmlToMarkdown(html)
    debug(`Generated markdown length: ${markdown.length}`)

    // Get cover image
    let cover: string | undefined
    const coverMeta = document.querySelector('meta[property="og:image"]')
    if (coverMeta) {
      const ogImage = coverMeta.getAttribute('content')
      // Ignore Feishu's default favicon
      if (ogImage && !ogImage.includes('feishu.ico')) {
        cover = ogImage
        debug(`Found cover from og:image: ${cover}`)
      }
    }
    if (!cover && images.length > 0) {
      cover = images[0]
      debug(`Using first image as cover`)
    }

    // Add cover to images list if not already included
    const imagesToDownload = [...images]
    if (cover && !imagesToDownload.includes(cover)) {
      imagesToDownload.push(cover)
    }

    // Pre-download images
    const imageDataMap = await downloadImages(imagesToDownload)

    // Use data URL for cover if available (so it can be displayed in popup)
    if (cover && imageDataMap[cover]) {
      debug(`Using data URL for cover`)
      cover = imageDataMap[cover]
    } else if (cover) {
      warn('Cover image not in imageDataMap, using original URL')
    }

    // Build article object
    const article: Article = {
      title,
      markdown: markdown.trim(),
      html,
      cover,
      source: {
        url: window.location.href,
        platform: 'feishu',
      },
      images: images.length > 0 ? images : undefined,
      imageDataMap: Object.keys(imageDataMap).length > 0 ? imageDataMap : undefined,
    }

    log('Successfully extracted article')
    return article
  } catch (err) {
    error('Extraction failed:', err)
    throw err
  }
}

/**
 * Initialize the content script
 */
function initializeContentScript() {
  log('Content script loaded (DOM-based version)')
  debug(`URL: ${window.location.href}`)
  debug(`Is Feishu page: ${isFeishuPage()}`)

  /**
   * Listen for extraction requests from background/popup
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    debug(`Received message: ${message.type}`)

    // Handle scroll to top
    if (message.type === 'SCROLL_TO_TOP') {
      debug('Scrolling to top...')
      // Feishu uses .bear-web-x-container as the actual scroll container
      const scrollContainer = document.querySelector('.bear-web-x-container') as HTMLElement
      if (scrollContainer) {
        scrollContainer.scrollTop = 0
        debug(`Scrolled container to top`)
      }
      window.scrollTo(0, 0)
      sendResponse({ success: true })
      return true
    }

    if (message.type === 'EXTRACT_ARTICLE') {
      debug('Extracting article...')

      extractFeishuArticle()
        .then((article) => {
          if (article) {
            log(`Sending article: ${article.title}`)
            sendResponse({ article, error: null })
          } else {
            error('Failed to extract article')
            sendResponse({
              article: null,
              error: 'Could not extract article. Make sure you are on a Feishu wiki/docs/docx page.',
            })
          }
        })
        .catch((err) => {
          error('Extraction error:', err)
          sendResponse({
            article: null,
            error: err instanceof Error ? err.message : String(err),
          })
        })

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
