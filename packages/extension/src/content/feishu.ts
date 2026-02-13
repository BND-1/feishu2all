/**
 * Feishu Content Extractor
 * Specialized extractor for Feishu (Lark) wiki/docs/docx pages
 * This is a content script that runs on Feishu pages
 */

import TurndownService from 'turndown'
import { processHtml, feishuCleanPreset } from '../popup/lib/html-processor'

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
 * Feishu-specific selectors
 *
 * IMPORTANT: Feishu docx uses a "block per paragraph" DOM model — each paragraph,
 * image, code block, etc. is a separate `[contenteditable="true"]` div. There is
 * NO single contenteditable that wraps the entire document. So we must NOT match
 * individual contenteditable elements; instead we need their **common parent
 * container** that holds ALL content blocks.
 *
 * Strategy:
 *   1. Try known container selectors that wrap all content blocks.
 *   2. If those fail, find a contenteditable leaf and walk UP to find the
 *      ancestor that contains multiple contenteditable siblings (= the container).
 */
const FEISHU_SELECTORS = {
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

  // Container selectors — elements that wrap ALL content blocks.
  // These are tried first via querySelector (first match wins).
  container: [
    '[data-content-editable-root="true"]',
    '#docx-container',
    '[class*="render-unit-wrapper"]',
    '[class*="doc-content-container"]',
    '[class*="doc-content"]',
    '[class*="wiki-content"]',
    '[class*="docx-content"]',
    '[class*="lark-editor"]',
    '[class*="editor-container"]',
    '[class*="EditorContainer"]',
    '.wiki-content',
    '.doc-content',
  ],

  // Leaf selectors — individual content blocks. Used to find ONE block,
  // then walk up to the container that holds all siblings.
  leaf: [
    '[data-content-editable-root="true"]',
    '[contenteditable="true"]',
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
 * Convert HTML to Markdown using Turndown (runs in content script with DOM access)
 */
function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })

  turndown.addRule('codeBlock', {
    filter: (node: HTMLElement) =>
      node.nodeName === 'PRE' &&
      (node.firstChild?.nodeName === 'CODE' || node.classList.contains('code')),
    replacement: (content: string, node: HTMLElement) => {
      const codeNode = node.firstChild as HTMLElement
      const lang =
        codeNode?.className?.match(/language-(\w+)/)?.[1] ||
        node.getAttribute('data-language') ||
        ''
      return '\n\n```' + lang + '\n' + content + '\n```\n\n'
    },
  })

  return turndown.turndown(html).trim()
}

/**
 * Clean HTML by removing unwanted elements — delegates to shared processor
 */
function cleanHtml(html: string): string {
  return processHtml(html, feishuCleanPreset)
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
    // Try multiple sources for the image
    const src = img.getAttribute('src') ||
                img.getAttribute('data-src') ||
                img.getAttribute('data-original')

    if (src) {
      // Handle relative URLs
      let fullUrl = src
      if (!src.startsWith('http') && !src.startsWith('data:image')) {
        // Convert relative URL to absolute
        try {
          fullUrl = new URL(src, window.location.href).href
        } catch {
          console.warn('[FeishuExtractor] Invalid image URL:', src)
          return
        }
      }

      images.push(fullUrl)
      console.log('[FeishuExtractor] Found image:', fullUrl)
    }
  })

  return [...new Set(images)]
}

/**
 * Extract article from Feishu page
 */
async function extractFeishuArticle(): Promise<Article | null> {
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

    // --- Find the content container ---
    // Feishu uses a "block per paragraph" DOM: each paragraph/image/code-block is
    // a separate element (often contenteditable). We need to find the PARENT that
    // wraps all these blocks, not an individual block.
    let contentElement: Element | null = null
    let matchedSelector = ''

    // Strategy 1: Try known container selectors directly.
    for (const selector of FEISHU_SELECTORS.container) {
      const el = document.querySelector(selector)
      if (el) {
        const textLen = el.textContent?.length || 0
        // A real container should have substantial content.
        // Also check it has multiple child elements (blocks).
        const childCount = el.children.length
        if (textLen < 100 || childCount < 2) {
          console.log(`[FeishuExtractor] Skipping container "${selector}" — too small (${textLen} chars, ${childCount} children)`)
          continue
        }
        contentElement = el
        matchedSelector = selector
        console.log(`[FeishuExtractor] Container found via "${selector}" (${textLen} chars, ${childCount} children, ${(el as HTMLElement).innerHTML.length} bytes HTML)`)
        break
      }
    }

    // Strategy 2: Find a contenteditable leaf and walk UP to the container.
    // The container is the nearest ancestor that holds multiple contenteditable children.
    if (!contentElement) {
      console.log('[FeishuExtractor] No container selector matched. Trying leaf-walk-up...')
      let leaf: Element | null = null
      for (const sel of FEISHU_SELECTORS.leaf) {
        leaf = document.querySelector(sel)
        if (leaf) break
      }
      if (leaf) {
        let parent = leaf.parentElement
        // Walk up, looking for a parent that contains ≥2 contenteditable descendants
        // (which means it's a multi-block container, not just one paragraph)
        for (let depth = 0; parent && depth < 15; depth++) {
          const editableCount = parent.querySelectorAll('[contenteditable="true"]').length
          const textLen = parent.textContent?.length || 0
          // Good container: has multiple editable blocks AND substantial text
          // Also reject if we've hit body or something with sidebar/toolbar indicators
          if (editableCount >= 2 && textLen > 200) {
            // Make sure this isn't too broad (e.g. body, #mainBox with sidebar)
            const hasSidebar = parent.querySelector('[class*="sidebar"], [class*="catalog-container"], [class*="navigation"]')
            if (!hasSidebar || parent.querySelector('[class*="page-content"], [class*="editor"]')) {
              contentElement = parent
              matchedSelector = `leaf-walk-up (depth=${depth}, ${editableCount} editables, ${textLen} chars)`
              console.log(`[FeishuExtractor] ${matchedSelector}, tag=${parent.tagName}, class=${parent.className?.substring(0, 60)}`)
              break
            }
          }
          parent = parent.parentElement
        }
      }
    }

    // Strategy 3: Heuristic — find the div with the most paragraph-like content
    if (!contentElement) {
      console.warn('[FeishuExtractor] No container found. Trying heuristic: largest text container...')
      let bestEl: Element | null = null
      let bestScore = 0
      document.querySelectorAll('div, article, section, main').forEach((el) => {
        if (el === document.body || el.tagName === 'HTML') return
        const textLen = el.textContent?.length || 0
        const editableCount = el.querySelectorAll('[contenteditable="true"]').length
        const hasContentSignals = el.querySelector('p, h1, h2, h3, h4, h5, h6, img, pre')
        if (!hasContentSignals) return
        // Score: text length + bonus for having multiple editable blocks
        const score = textLen + editableCount * 500
        if (score > bestScore) {
          bestScore = score
          bestEl = el
        }
      })
      if (bestEl) {
        contentElement = bestEl
        matchedSelector = `heuristic (score=${bestScore})`
        console.log(`[FeishuExtractor] Heuristic match: ${(bestEl as HTMLElement).className?.substring(0, 60)} (score=${bestScore})`)
      }
    }

    if (!contentElement) {
      console.error('[FeishuExtractor] Could not find any content element')
      return null
    }

    // Clone so we don't mutate the live DOM
    const targetEl = contentElement.cloneNode(true) as HTMLElement

    // Remove UI chrome that might be inside the content container
    targetEl.querySelectorAll([
      '[class*="doc-info-wrapper"]', '[class*="doc-meta"]', '[class*="doc-info"]',
      '[class*="sidebar"]', '[class*="toolbar"]', '[class*="tooltip"]',
      '[class*="catalog"]', '[class*="comment"]', '[class*="navigation"]',
      '[class*="header-bar"]', '[class*="title-input"]',
      '[class*="reaction"]', '[class*="like-btn"]',
      '[data-testid*="toolbar"]', '[data-testid*="sidebar"]',
      'button', '[role="button"]',
    ].join(', ')).forEach((el) => el.remove())

    // Get HTML content
    let html = targetEl.innerHTML

    console.log('[FeishuExtractor] Matched selector:', matchedSelector)
    console.log('[FeishuExtractor] Container tag:', contentElement.tagName, 'children:', contentElement.children.length)
    console.log('[FeishuExtractor] Editable blocks inside:', contentElement.querySelectorAll('[contenteditable="true"]').length)
    console.log('[FeishuExtractor] Images inside:', contentElement.querySelectorAll('img').length)
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
      console.log('[FeishuExtractor] Cover from og:image meta tag:', cover)
    }

    // Extract images first to use for cover fallback
    const images = extractImagesFromHtml(html)
    console.log('[FeishuExtractor] Total images found:', images.length)

    // If no og:image meta tag, use the first image from content
    if (!cover && images.length > 0) {
      cover = images[0]
      console.log('[FeishuExtractor] Using first image as cover:', cover)
    }

    console.log('[FeishuExtractor] Final cover URL:', cover || 'none')

    // Get description from meta
    const descriptionMeta = document.querySelector('meta[property="og:description"], meta[name="description"]')
    const description = descriptionMeta?.getAttribute('content') || undefined

    // Pre-download images in content script context (has Feishu CDN cookies)
    const imageDataMap: Record<string, string> = {}
    if (images.length > 0) {
      console.log(`[FeishuExtractor] Pre-downloading ${images.length} images...`)
      for (const imgUrl of images) {
        try {
          const resp = await fetch(imgUrl, { credentials: 'include' })
          if (resp.ok) {
            const blob = await resp.blob()
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as string)
              reader.onerror = () => reject(new Error('FileReader error'))
              reader.readAsDataURL(blob)
            })
            imageDataMap[imgUrl] = dataUrl
            console.log(`[FeishuExtractor] Downloaded image: ${imgUrl.substring(0, 80)}...`)
          } else {
            console.warn(`[FeishuExtractor] Failed to download image (${resp.status}): ${imgUrl}`)
          }
        } catch (err) {
          console.warn(`[FeishuExtractor] Image download error: ${imgUrl}`, err)
        }
      }
      console.log(`[FeishuExtractor] Downloaded ${Object.keys(imageDataMap).length}/${images.length} images`)
    }

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

    if (Object.keys(imageDataMap).length > 0) {
      article.imageDataMap = imageDataMap
    }

    console.log(`[FeishuExtractor] Successfully extracted article: ${title}`)
    console.log('[FeishuExtractor] Image count:', images.length)
    console.log('[FeishuExtractor] Pre-downloaded images:', Object.keys(imageDataMap).length)

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
