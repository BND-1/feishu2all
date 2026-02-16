/**
 * Feishu Content Extractor
 * Specialized extractor for Feishu (Lark) wiki/docs/docx pages
 * This is a content script that runs on Feishu pages
 *
 * Strategy:
 * 1. Try to use window.DATA (SSR data, fast and reliable)
 * 2. Fallback to DOM extraction (slower, but works if SSR data unavailable)
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

// Feishu SSR data structure
interface FeishuBlock {
  id: string
  version: number
  data: {
    type: string  // text, heading1-9, image, code, etc.
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
    parent_id?: string
    children?: string[]
    [key: string]: any
  }
}

interface FeishuSSRData {
  clientVars?: {
    data?: {
      block_map?: Record<string, FeishuBlock>
      [key: string]: any
    }
  }
  meta?: {
    title?: string
    token?: string
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
 * Get Feishu SSR data from window.DATA
 */
function getFeishuSSRData(): FeishuSSRData | null {
  try {
    const windowData = (window as any).DATA
    if (!windowData) {
      console.log('[FeishuExtractor] window.DATA not found')
      return null
    }

    console.log('[FeishuExtractor] Found window.DATA:', {
      hasClientVars: !!windowData.clientVars,
      hasMeta: !!windowData.meta,
      metaTitle: windowData.meta?.title,
    })

    return windowData as FeishuSSRData
  } catch (error) {
    console.error('[FeishuExtractor] Failed to get SSR data:', error)
    return null
  }
}

/**
 * Decode HTML entities in URL (safe method)
 */
function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Build Feishu image URL from token
 */
function buildImageURL(token: string): string {
  // Use the same URL pattern as in the DOM
  // Extract mount_node_token from current document if available
  const docToken = (window as any).DATA?.meta?.token || ''
  const domain = window.location.hostname

  // Build URL similar to what Feishu uses
  return `https://internal-api-drive-stream.${domain.includes('feishu.cn') ? 'feishu.cn' : 'larksuite.com'}/space/api/box/stream/download/v2/cover/${token}/?fallback_source=1&height=1280&mount_node_token=${docToken}&mount_point=docx_image&policy=equal&width=1280`
}

/**
 * Convert Feishu block to markdown
 */
function blockToMarkdown(block: FeishuBlock): string {
  const { type, text, image, code } = block.data

  // Extract text content
  const getText = (): string => {
    if (!text?.initialAttributedTexts?.text) return ''
    const textObj = text.initialAttributedTexts.text
    // Combine all text segments
    return Object.values(textObj).join('')
  }

  switch (type) {
    case 'heading1':
      return `# ${getText()}\n\n`
    case 'heading2':
      return `## ${getText()}\n\n`
    case 'heading3':
      return `### ${getText()}\n\n`
    case 'heading4':
      return `#### ${getText()}\n\n`
    case 'heading5':
      return `##### ${getText()}\n\n`
    case 'heading6':
      return `###### ${getText()}\n\n`
    case 'heading7':
    case 'heading8':
    case 'heading9':
      return `###### ${getText()}\n\n`
    case 'text':
      return `${getText()}\n\n`
    case 'image':
      // Try to get URL from token first, fallback to url field
      let imageUrl = ''
      if (image?.token) {
        imageUrl = buildImageURL(image.token)
      } else if (image?.url) {
        imageUrl = decodeHTMLEntities(image.url)
      }
      return imageUrl ? `![](${imageUrl})\n\n` : ''
    case 'code':
      const lang = code?.language || ''
      const codeText = code?.text || getText()
      return `\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`
    default:
      // For unknown types, try to extract text
      const content = getText()
      return content ? `${content}\n\n` : ''
  }
}

/**
 * Extract article from SSR data
 */
async function extractArticleFromSSR(ssrData: FeishuSSRData): Promise<Article | null> {
  try {
    console.log('[FeishuExtractor] Extracting from SSR data...')

    // Extract title
    const title = ssrData.meta?.title || 'Untitled Document'
    console.log('[FeishuExtractor] Title:', title)

    // Extract blocks
    const blockMap = ssrData.clientVars?.data?.block_map
    const blockSequence = (ssrData.clientVars?.data as any)?.block_sequence

    if (!blockMap) {
      console.warn('[FeishuExtractor] No block_map found in SSR data')
      return null
    }

    console.log('[FeishuExtractor] Found', Object.keys(blockMap).length, 'blocks in block_map')

    // Use block_sequence to maintain correct order
    let orderedBlocks: FeishuBlock[]

    if (blockSequence && Array.isArray(blockSequence)) {
      console.log('[FeishuExtractor] Using block_sequence with', blockSequence.length, 'blocks')
      // Skip first block (document root)
      orderedBlocks = blockSequence
        .slice(1)
        .map((id: string) => blockMap[id])
        .filter((block: FeishuBlock) => block != null)
    } else {
      // Fallback: find root blocks
      console.log('[FeishuExtractor] No block_sequence, using parent_id filtering')
      const docToken = ssrData.meta?.token
      orderedBlocks = Object.values(blockMap).filter(
        (block) => block.data.parent_id === docToken
      )
    }

    console.log('[FeishuExtractor] Processing', orderedBlocks.length, 'blocks')

    // Convert blocks to markdown
    let markdown = ''
    const images: string[] = []

    for (const block of orderedBlocks) {
      const blockMarkdown = blockToMarkdown(block)
      markdown += blockMarkdown

      // Collect image URLs
      if (block.data.type === 'image') {
        let imageUrl = ''
        if (block.data.image?.token) {
          imageUrl = buildImageURL(block.data.image.token)
        } else if (block.data.image?.url) {
          imageUrl = decodeHTMLEntities(block.data.image.url)
        }
        if (imageUrl) {
          images.push(imageUrl)
        }
      }
    }

    console.log('[FeishuExtractor] Generated markdown length:', markdown.length)
    console.log('[FeishuExtractor] Found', images.length, 'images')

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
      markdown: markdown.trim(),
      cover,
      source: {
        url: window.location.href,
        platform: 'feishu',
      },
      images: images.length > 0 ? images : undefined,
      imageDataMap: Object.keys(imageDataMap).length > 0 ? imageDataMap : undefined,
    }

    console.log('[FeishuExtractor] Successfully extracted article from SSR data')
    return article
  } catch (error) {
    console.error('[FeishuExtractor] Failed to extract from SSR data:', error)
    return null
  }
}

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
  // Feishu uses block-based structure: docx-heading1-block, docx-text-block, docx-image-block, etc.
  container: [
    '[data-content-editable-root="true"]',
    '#docx-container',
    '[class*="page-block-children"]',
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

  // Block selectors — Feishu's content blocks
  blocks: [
    '.docx-heading1-block',
    '.docx-heading2-block',
    '.docx-heading3-block',
    '.docx-heading4-block',
    '.docx-heading5-block',
    '.docx-heading6-block',
    '.docx-heading7-block',
    '.docx-heading8-block',
    '.docx-heading9-block',
    '.docx-text-block',
    '.docx-image-block',
    '.docx-code-block',
    '.docx-list-block',
    '.docx-table-block',
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

  // Handle images - ensure proper conversion even if src is missing
  turndown.addRule('image', {
    filter: 'IMG',
    replacement: (content: string, node: HTMLElement) => {
      const alt = node.getAttribute('alt') || ''
      const src = node.getAttribute('src') || ''
      // If no src, return empty string to avoid breaking markdown flow
      if (!src) {
        console.warn('[FeishuExtractor] Image without src attribute:', node.outerHTML?.substring(0, 100))
        return ''
      }
      const title = node.getAttribute('title')
      return `![${alt}](${src}${title ? ` "${title}"` : ''})`
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
 * Extract image URLs from the entire document
 * More robust than extracting from HTML string
 */
function extractImagesFromDocument(): string[] {
  const images: string[] = []

  // Find all images with docx-image class (document content images)
  // Also include images without specific class as fallback
  const imgElements = document.querySelectorAll('img.docx-image, img[src*="feishu.cn"]')

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
      console.log('[FeishuExtractor] Found image:', fullUrl.substring(0, 80) + '...')
    }
  })

  return [...new Set(images)]
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
 * Scroll page to load all lazy-loaded images and collect all blocks
 * Feishu uses virtual scrolling, so we need to collect blocks as we scroll
 */
async function scrollToLoadImages(): Promise<HTMLElement[]> {
  console.log('[FeishuExtractor] Auto-scrolling to load lazy images and collect blocks...')

  const scrollStep = 500 // Scroll 500px at a time
  const scrollDelay = 300 // Wait 300ms between scrolls to allow rendering
  const finalDelay = 1000 // Wait 1s at the end

  const totalHeight = document.documentElement.scrollHeight
  let currentPosition = 0

  // Use a Map to deduplicate blocks by their text content
  const collectedBlocks = new Map<string, HTMLElement>()

  // Collect blocks at current position
  const collectCurrentBlocks = () => {
    const blocks = document.querySelectorAll(FEISHU_SELECTORS.blocks.join(', '))
    blocks.forEach((block) => {
      const text = block.textContent?.trim() || ''
      // Use text content as key to deduplicate (same block might appear multiple times)
      if (text && !collectedBlocks.has(text)) {
        collectedBlocks.set(text, block.cloneNode(true) as HTMLElement)
      }
    })
  }

  // Collect blocks at the start
  collectCurrentBlocks()
  console.log('[FeishuExtractor] Collected', collectedBlocks.size, 'blocks at start')

  while (currentPosition < totalHeight) {
    window.scrollTo(0, currentPosition)
    currentPosition += scrollStep
    await new Promise(resolve => setTimeout(resolve, scrollDelay))

    // Collect blocks at current scroll position
    collectCurrentBlocks()
    console.log('[FeishuExtractor] Collected', collectedBlocks.size, 'blocks at position', currentPosition)
  }

  // Scroll to bottom
  window.scrollTo(0, totalHeight)
  await new Promise(resolve => setTimeout(resolve, finalDelay))
  collectCurrentBlocks()

  // Scroll back to top
  window.scrollTo(0, 0)
  await new Promise(resolve => setTimeout(resolve, 300))

  console.log('[FeishuExtractor] Auto-scroll completed, total blocks:', collectedBlocks.size)

  // Return blocks as array
  return Array.from(collectedBlocks.values())
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

    // Strategy 1: Try to use SSR data from window.DATA (fast and reliable)
    console.log('[FeishuExtractor] Attempting SSR data extraction...')
    const ssrData = getFeishuSSRData()

    if (ssrData) {
      const article = await extractArticleFromSSR(ssrData)
      if (article) {
        console.log('[FeishuExtractor] Successfully extracted from SSR data')
        return article
      }
      console.log('[FeishuExtractor] SSR extraction failed, falling back to DOM')
    } else {
      console.log('[FeishuExtractor] No SSR data available, using DOM extraction')
    }

    // Strategy 2: Fallback to DOM extraction (slower but reliable)
    console.log('[FeishuExtractor] Using DOM-based extraction...')

    // Auto-scroll to load all lazy-loaded images and collect all blocks
    const collectedBlocks = await scrollToLoadImages()
    console.log('[FeishuExtractor] Total collected blocks:', collectedBlocks.length)

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

    // --- Strategy: Use collected blocks from scrolling ---
    // Create a temporary container to hold all collected blocks
    const tempContainer = document.createElement('div')
    collectedBlocks.forEach(block => {
      tempContainer.appendChild(block)
    })

    // Get HTML content from collected blocks
    let html = tempContainer.innerHTML

    console.log('[FeishuExtractor] Collected blocks HTML length:', html.length)
    console.log('[FeishuExtractor] Images in blocks:', tempContainer.querySelectorAll('img').length)

    // If we have blocks, use them directly
    if (html.length > 100) {
      console.log('[FeishuExtractor] Using collected blocks as content source')

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

      // Extract images from the entire document (not just the container)
      // This is more robust as Feishu's DOM structure may vary
      const images = extractImagesFromDocument()
      console.log('[FeishuExtractor] Total images found in document:', images.length)

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
        images: images.length > 0 ? images : undefined,
        imageDataMap: Object.keys(imageDataMap).length > 0 ? imageDataMap : undefined,
      }

      console.log('[FeishuExtractor] Successfully extracted article:', title)
      console.log('[FeishuExtractor] Image count:', images.length)
      console.log('[FeishuExtractor] Pre-downloaded images:', Object.keys(imageDataMap).length)

      return article
    }

    // Fallback: Try to find container (old logic)
    console.warn('[FeishuExtractor] Not enough content in blocks, trying container fallback...')

    // --- Find the content container (fallback) ---
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

    // Get HTML content (reuse html variable from above)
    html = targetEl.innerHTML

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

    // Extract images from the entire document (not just the container)
    // This is more robust as Feishu's DOM structure may vary
    const images = extractImagesFromDocument()
    console.log('[FeishuExtractor] Total images found in document:', images.length)

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
