/**
 * Feishu Content Extractor (Hybrid: SSR + DOM fallback)
 * Extracts article content from Feishu (Lark) wiki/docs/docx pages
 *
 * Strategy:
 * 1. Try SSR data (window.DATA) - complete content, works with virtual scrolling
 * 2. Fallback to DOM extraction - may be incomplete due to virtual scrolling
 */

import TurndownService from 'turndown'

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

// Feishu SSR data structure
interface FeishuBlock {
  id: string
  version: number
  data: {
    type: string
    text?: {
      initialAttributedTexts?: {
        text?: Record<string, string>
      }
    }
    image?: {
      token?: string
      url?: string
    }
    code?: {
      language?: string
      text?: string
    }
    [key: string]: any
  }
}

interface FeishuSSRData {
  clientVars?: {
    data?: {
      block_map?: Record<string, FeishuBlock>
      block_sequence?: string[]
      [key: string]: any
    }
  }
  meta?: {
    title?: string
    [key: string]: any
  }
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
 * Get Feishu SSR data from window.DATA
 */
function getFeishuSSRData(): FeishuSSRData | null {
  try {
    const windowData = (window as any).DATA
    if (!windowData) {
      console.log('[FeishuExtractor] window.DATA not found')
      return null
    }

    console.log('[FeishuExtractor] Found window.DATA')
    return windowData as FeishuSSRData
  } catch (error) {
    console.error('[FeishuExtractor] Failed to get SSR data:', error)
    return null
  }
}

/**
 * Convert Feishu block to HTML
 */
function blockToHtml(block: FeishuBlock): string {
  const type = block.data.type

  // Text blocks
  if (type === 'text' || type === 'paragraph') {
    const text = block.data.text?.initialAttributedTexts?.text?.['0'] || ''
    return `<p>${text}</p>`
  }

  // Headings
  if (type.startsWith('heading')) {
    const level = type.replace('heading', '')
    const text = block.data.text?.initialAttributedTexts?.text?.['0'] || ''
    return `<h${level}>${text}</h${level}>`
  }

  // Images
  if (type === 'image') {
    const url = block.data.image?.url || ''
    if (url) {
      return `<img src="${url}" />`
    }
  }

  // Code blocks
  if (type === 'code') {
    const code = block.data.code?.text || ''
    const lang = block.data.code?.language || ''
    return `<pre><code class="language-${lang}">${code}</code></pre>`
  }

  // Lists
  if (type === 'bullet' || type === 'ordered') {
    const text = block.data.text?.initialAttributedTexts?.text?.['0'] || ''
    return `<li>${text}</li>`
  }

  // Fallback: extract any text
  const text = block.data.text?.initialAttributedTexts?.text?.['0'] || ''
  if (text) {
    return `<p>${text}</p>`
  }

  return ''
}

/**
 * Extract article from SSR data
 */
async function extractFromSSR(ssrData: FeishuSSRData): Promise<Article | null> {
  try {
    console.log('[FeishuExtractor] Extracting from SSR data...')

    const title = ssrData.meta?.title || 'Untitled Document'
    const blockMap = ssrData.clientVars?.data?.block_map
    const blockSequence = ssrData.clientVars?.data?.block_sequence

    if (!blockMap) {
      console.warn('[FeishuExtractor] No block_map found')
      return null
    }

    console.log('[FeishuExtractor] Found', Object.keys(blockMap).length, 'blocks')

    // Get ordered blocks
    let orderedBlocks: FeishuBlock[]
    if (blockSequence && Array.isArray(blockSequence)) {
      orderedBlocks = blockSequence
        .slice(1) // Skip document root
        .map((id: string) => blockMap[id])
        .filter((block: FeishuBlock) => block != null)
    } else {
      orderedBlocks = Object.values(blockMap)
    }

    // Convert blocks to HTML
    const htmlParts: string[] = []
    const imageUrls: string[] = []

    for (const block of orderedBlocks) {
      const html = blockToHtml(block)
      if (html) {
        htmlParts.push(html)

        // Extract image URLs
        if (block.data.type === 'image' && block.data.image?.url) {
          const url = decodeHtmlEntities(block.data.image.url)
          if (!imageUrls.includes(url)) {
            imageUrls.push(url)
          }
        }
      }
    }

    const html = htmlParts.join('\n')
    console.log('[FeishuExtractor] Generated HTML length:', html.length)
    console.log('[FeishuExtractor] Found', imageUrls.length, 'images')

    // Convert to Markdown
    const markdown = htmlToMarkdown(html)

    // Download images
    const imageDataMap = await downloadImages(imageUrls)

    return {
      title,
      markdown,
      html,
      source: {
        url: window.location.href,
        platform: 'feishu',
      },
      images: imageUrls.length > 0 ? imageUrls : undefined,
      imageDataMap: Object.keys(imageDataMap).length > 0 ? imageDataMap : undefined,
    }
  } catch (error) {
    console.error('[FeishuExtractor] SSR extraction failed:', error)
    return null
  }
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

  console.log(`[FeishuExtractor] Pre-downloading ${imageUrls.length} images...`)
  console.log(`[FeishuExtractor] Image URLs:`, imageUrls)

  for (const imgUrl of imageUrls) {
    try {
      console.log(`[FeishuExtractor] Downloading: ${imgUrl}`)
      const resp = await fetch(imgUrl, { credentials: 'include' })

      if (!resp.ok) {
        console.error(`[FeishuExtractor] Download failed (${resp.status} ${resp.statusText}): ${imgUrl}`)
        continue
      }

      const blob = await resp.blob()

      if (blob.size === 0) {
        console.error(`[FeishuExtractor] Downloaded blob is empty: ${imgUrl}`)
        continue
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('FileReader error'))
        reader.readAsDataURL(blob)
      })

      imageDataMap[imgUrl] = dataUrl
      console.log(`[FeishuExtractor] Downloaded successfully (${blob.size} bytes, ${blob.type}): ${imgUrl.substring(0, 80)}...`)
    } catch (err) {
      console.error(`[FeishuExtractor] Download error: ${imgUrl}`, err)
    }
  }

  console.log(`[FeishuExtractor] Downloaded ${Object.keys(imageDataMap).length}/${imageUrls.length} images`)
  console.log(`[FeishuExtractor] imageDataMap keys:`, Object.keys(imageDataMap))

  // Log failed downloads
  const failed = imageUrls.filter(url => !imageDataMap[url])
  if (failed.length > 0) {
    console.warn(`[FeishuExtractor] Failed to download ${failed.length} images:`, failed)
  }

  return imageDataMap
}

/**
 * Create Turndown service for HTML to Markdown conversion
 */
function createTurndownService(): TurndownService {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })

  // IMPORTANT: Add custom image rule FIRST to override default behavior
  // Custom rule for images to decode HTML entities in URLs
  turndownService.addRule('images', {
    filter: 'img',
    replacement: function (content, node) {
      const alt = (node as HTMLImageElement).alt || ''
      let src = (node as HTMLImageElement).getAttribute('src') || ''

      // Decode HTML entities in URL
      src = decodeHtmlEntities(src)

      return src ? '![' + alt + '](' + src + ')' : ''
    },
  })

  // Add table support
  turndownService.addRule('table', {
    filter: 'table',
    replacement: function (content) {
      return '\n\n' + content + '\n\n'
    },
  })

  turndownService.addRule('tableRow', {
    filter: 'tr',
    replacement: function (content, node) {
      return content + '\n'
    },
  })

  turndownService.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: function (content, node) {
      const parent = node.parentNode as HTMLElement
      const siblings = parent.querySelectorAll('th, td')
      const index = Array.from(siblings).indexOf(node as HTMLElement)
      const prefix = index === 0 ? '| ' : ' '
      return prefix + content + ' |'
    },
  })

  return turndownService
}

/**
 * Convert HTML to Markdown using Turndown
 */
function htmlToMarkdown(html: string): string {
  const turndownService = createTurndownService()
  return turndownService.turndown(html)
}

/**
 * Collect all content blocks by scrolling and observing DOM changes
 * Based on: https://greasyfork.org/scripts/470055
 */
async function collectAllContentBlocks(): Promise<DocumentFragment | null> {
  console.log('[FeishuExtractor] Collecting all content blocks...')

  const scrollContainer = document.querySelector('.bear-web-x-container') as HTMLElement
  const contentContainer = document.querySelector('.render-unit-wrapper') as HTMLElement

  if (!scrollContainer || !contentContainer) {
    console.warn('[FeishuExtractor] Could not find Feishu containers')
    console.log('[FeishuExtractor] scrollContainer:', !!scrollContainer)
    console.log('[FeishuExtractor] contentContainer:', !!contentContainer)
    return null
  }

  console.log('[FeishuExtractor] Found Feishu containers')

  const fragment = document.createDocumentFragment()
  const collectedIds = new Set<string>()

  // Collect existing nodes
  function collectNodes(nodes: NodeList) {
    for (const node of Array.from(nodes)) {
      const el = node as HTMLElement
      if (el.hasAttribute && el.hasAttribute('data-block-id') && !el.classList.contains('isEmpty')) {
        const blockId = el.getAttribute('data-block-id')
        if (blockId && !collectedIds.has(blockId)) {
          fragment.appendChild(el.cloneNode(true))
          collectedIds.add(blockId)
        }
      }
    }
  }

  // Collect initial content
  collectNodes(contentContainer.childNodes)
  console.log('[FeishuExtractor] Initial blocks collected:', collectedIds.size)

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

  console.log('[FeishuExtractor] Collection complete, total blocks:', collectedIds.size)
  return fragment
}

/**
 * Attempt to disable virtual scrolling by forcing full render
 */
async function disableVirtualScrolling(): Promise<boolean> {
  console.log('[FeishuExtractor] Attempting to disable virtual scrolling...')

  try {
    // Find the scroll container
    const selectors = ['.doc-render', '.wiki-render', '.docs-reader', '[class*="render"]']
    let container: HTMLElement | null = null

    for (const selector of selectors) {
      const el = document.querySelector(selector) as HTMLElement
      if (el && el.scrollHeight > el.clientHeight) {
        container = el
        console.log('[FeishuExtractor] Found scroll container:', selector)
        break
      }
    }

    if (!container) {
      console.warn('[FeishuExtractor] Could not find scroll container')
      return false
    }

    // Save original styles
    const originalStyles = {
      height: container.style.height,
      maxHeight: container.style.maxHeight,
      overflow: container.style.overflow,
    }

    // Force full height to render all content
    container.style.height = 'auto'
    container.style.maxHeight = 'none'
    container.style.overflow = 'visible'

    console.log('[FeishuExtractor] Modified container styles, waiting for render...')

    // Wait for content to render
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Check if it worked
    const imageCount = container.querySelectorAll('img').length
    const textLength = container.textContent?.length || 0

    console.log('[FeishuExtractor] After disabling virtual scroll:', {
      imageCount,
      textLength,
    })

    // Restore original styles (optional - keep disabled for extraction)
    // container.style.height = originalStyles.height
    // container.style.maxHeight = originalStyles.maxHeight
    // container.style.overflow = originalStyles.overflow

    return imageCount > 0 || textLength > 1000
  } catch (error) {
    console.error('[FeishuExtractor] Failed to disable virtual scrolling:', error)
    return false
  }
}

/**
 * Scroll page to load all lazy-loaded content
 * Feishu uses virtual scrolling - content only loads when visible
 */
async function scrollToLoadAllContent(): Promise<void> {
  console.log('[FeishuExtractor] Starting auto-scroll to load all content...')

  const scrollContainer = document.querySelector('.doc-render, .wiki-render, .docs-reader, [class*="render"]') as HTMLElement
  if (!scrollContainer) {
    console.warn('[FeishuExtractor] Could not find scroll container, using window')
  }

  const targetElement = scrollContainer || document.documentElement
  const scrollHeight = targetElement.scrollHeight
  const clientHeight = targetElement.clientHeight
  const scrollStep = clientHeight * 0.8 // Scroll 80% of viewport at a time
  let currentScroll = 0

  console.log('[FeishuExtractor] Total scroll height:', scrollHeight)

  // Scroll down in steps to trigger lazy loading
  while (currentScroll < scrollHeight) {
    currentScroll += scrollStep

    if (scrollContainer) {
      scrollContainer.scrollTop = currentScroll
    } else {
      window.scrollTo(0, currentScroll)
    }

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  // Scroll to bottom to ensure everything is loaded
  if (scrollContainer) {
    scrollContainer.scrollTop = scrollHeight
  } else {
    window.scrollTo(0, scrollHeight)
  }
  await new Promise(resolve => setTimeout(resolve, 500))

  // Scroll back to top
  if (scrollContainer) {
    scrollContainer.scrollTop = 0
  } else {
    window.scrollTo(0, 0)
  }
  await new Promise(resolve => setTimeout(resolve, 200))

  console.log('[FeishuExtractor] Auto-scroll completed')
}

/**
 * Extract article from Feishu page (hybrid approach)
 */
async function extractFeishuArticle(): Promise<Article | null> {
  try {
    console.log('[FeishuExtractor] Starting extraction...')

    if (!isFeishuPage()) {
      console.warn('[FeishuExtractor] Not a Feishu page')
      return null
    }

    // Try SSR extraction first (works with virtual scrolling)
    const ssrData = getFeishuSSRData()
    if (ssrData) {
      console.log('[FeishuExtractor] Using SSR extraction (complete content)')
      const article = await extractFromSSR(ssrData)
      if (article) {
        return article
      }
    }

    // Fallback to DOM extraction (may be incomplete due to virtual scrolling)
    console.warn('[FeishuExtractor] SSR extraction failed, falling back to DOM extraction')
    console.warn('[FeishuExtractor] WARNING: Content may be incomplete due to virtual scrolling')
    return await extractFromDOM()
  } catch (error) {
    console.error('[FeishuExtractor] Extraction failed:', error)
    throw error
  }
}

/**
 * Extract from DOM (fallback, may be incomplete)
 */
async function extractFromDOM(): Promise<Article | null> {
  try {
    console.log('[FeishuExtractor] Starting DOM-based extraction...')

    // Try to collect all content blocks (handles virtual scrolling)
    const fragment = await collectAllContentBlocks()
    let contentContainer: HTMLElement | DocumentFragment | null = fragment

    if (!contentContainer) {
      console.warn('[FeishuExtractor] Could not collect content blocks, trying standard selectors...')

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
          console.log('[FeishuExtractor] Found content with selector:', selector)
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
    console.log('[FeishuExtractor] Title:', title)

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
    console.log('[FeishuExtractor] Found', images.length, 'images')

    // Get HTML content
    const html = clonedContent.innerHTML

    // Convert to Markdown
    const markdown = htmlToMarkdown(html)
    console.log('[FeishuExtractor] Generated markdown length:', markdown.length)

    // Get cover image
    let cover: string | undefined
    const coverMeta = document.querySelector('meta[property="og:image"]')
    if (coverMeta) {
      cover = coverMeta.getAttribute('content') || undefined
    }
    if (!cover && images.length > 0) {
      cover = images[0]
    }

    // Pre-download images
    const imageDataMap = await downloadImages(images)

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

    console.log('[FeishuExtractor] Successfully extracted article')
    return article
  } catch (error) {
    console.error('[FeishuExtractor] Extraction failed:', error)
    throw error
  }
}

/**
 * Initialize the content script
 */
function initializeContentScript() {
  console.log('[FeishuExtractor] Feishu content script loaded (DOM-based version)')
  console.log('[FeishuExtractor] URL:', window.location.href)
  console.log('[FeishuExtractor] Is Feishu page:', isFeishuPage())

  /**
   * Listen for extraction requests from background/popup
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[FeishuExtractor] Received message:', message.type, message)

    if (message.type === 'EXTRACT_ARTICLE') {
      console.log('[FeishuExtractor] Extracting article...')

      extractFeishuArticle()
        .then((article) => {
          if (article) {
            console.log('[FeishuExtractor] Sending article:', article.title)
            sendResponse({ article, error: null })
          } else {
            console.error('[FeishuExtractor] Failed to extract article')
            sendResponse({
              article: null,
              error: 'Could not extract article. Make sure you are on a Feishu wiki/docs/docx page.',
            })
          }
        })
        .catch((error) => {
          console.error('[FeishuExtractor] Extraction error:', error)
          sendResponse({
            article: null,
            error: error instanceof Error ? error.message : String(error),
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
