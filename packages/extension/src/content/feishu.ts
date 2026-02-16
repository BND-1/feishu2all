/**
 * Feishu Content Extractor (Simplified)
 * Specialized extractor for Feishu (Lark) wiki/docs/docx pages
 *
 * Strategy: SSR-only extraction (fast, reliable, covers 90%+ cases)
 * - Extracts from window.DATA.clientVars.data.block_map
 * - No DOM fallback (keeps code simple and maintainable)
 * - Clear error messages when SSR data unavailable
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
      block_sequence?: string[]
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
 * Check if current URL is a Feishu document
 */
function isFeishuPage(): boolean {
  const url = window.location.href
  return FEISHU_PATTERNS.some((pattern) => pattern.test(url))
}

/**
 * Wait for window.DATA to be available
 * Feishu injects DATA after page load, so we need to wait
 */
async function waitForSSRData(timeoutMs: number = 5000): Promise<FeishuSSRData | null> {
  const startTime = Date.now()

  // Check if already available
  const existingData = (window as any).DATA
  if (existingData?.clientVars?.data?.block_map) {
    console.log('[FeishuExtractor] window.DATA already available')
    return existingData as FeishuSSRData
  }

  console.log('[FeishuExtractor] Waiting for window.DATA...')

  // Poll for DATA with exponential backoff
  return new Promise((resolve) => {
    const checkInterval = 100 // Check every 100ms
    let attempts = 0

    const intervalId = setInterval(() => {
      attempts++
      const elapsed = Date.now() - startTime

      const windowData = (window as any).DATA
      if (windowData?.clientVars?.data?.block_map) {
        console.log(`[FeishuExtractor] window.DATA found after ${elapsed}ms (${attempts} attempts)`)
        clearInterval(intervalId)
        resolve(windowData as FeishuSSRData)
        return
      }

      if (elapsed >= timeoutMs) {
        console.warn(`[FeishuExtractor] Timeout waiting for window.DATA after ${elapsed}ms`)
        clearInterval(intervalId)
        resolve(null)
      }
    }, checkInterval)
  })
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
 * Normalize URL for consistent matching
 * Decodes HTML entities to match markdown extraction
 */
function normalizeImageUrl(url: string): string {
  return url
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
  const docToken = (window as any).DATA?.meta?.token || ''
  const domain = window.location.hostname

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
      let imageUrl = ''
      if (image?.token) {
        imageUrl = buildImageURL(image.token)
      } else if (image?.url) {
        imageUrl = normalizeImageUrl(image.url)
      }
      return imageUrl ? `![](${imageUrl})\n\n` : ''
    case 'code':
      const lang = code?.language || ''
      const codeText = code?.text || getText()
      return `\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`
    default:
      const content = getText()
      return content ? `${content}\n\n` : ''
  }
}

/**
 * Download images and convert to data URLs
 * Pre-downloads images in content script context (has Feishu CDN cookies)
 */
async function downloadImages(imageUrls: string[]): Promise<Record<string, string>> {
  const imageDataMap: Record<string, string> = {}

  if (imageUrls.length === 0) return imageDataMap

  console.log(`[FeishuExtractor] Pre-downloading ${imageUrls.length} images...`)

  for (const imgUrl of imageUrls) {
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

        // Normalize URL to match markdown extraction
        const normalizedUrl = normalizeImageUrl(imgUrl)
        imageDataMap[normalizedUrl] = dataUrl

        console.log(`[FeishuExtractor] Downloaded: ${imgUrl.substring(0, 80)}...`)
      }
    } catch (err) {
      console.warn(`[FeishuExtractor] Download failed: ${imgUrl}`, err)
    }
  }

  console.log(`[FeishuExtractor] Downloaded ${Object.keys(imageDataMap).length}/${imageUrls.length} images`)
  return imageDataMap
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
    const blockSequence = ssrData.clientVars?.data?.block_sequence

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

    // Convert blocks to markdown and collect image URLs
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
          imageUrl = normalizeImageUrl(block.data.image.url)
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
    const imageDataMap = await downloadImages(images)

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
 * Extract article from Feishu page (SSR-only, no DOM fallback)
 */
async function extractFeishuArticle(): Promise<Article | null> {
  try {
    console.log('[FeishuExtractor] Starting extraction...')

    if (!isFeishuPage()) {
      console.warn('[FeishuExtractor] Not a Feishu page')
      return null
    }

    // Wait for SSR data to be available (Feishu injects it after page load)
    const ssrData = await waitForSSRData(5000)

    if (!ssrData) {
      console.error('[FeishuExtractor] No SSR data available after waiting')
      throw new Error('该页面不支持内容提取，请刷新页面后重试。若问题持续，请联系管理员。')
    }

    const article = await extractArticleFromSSR(ssrData)

    if (!article) {
      throw new Error('内容提取失败，请确认页面已完全加载。')
    }

    console.log('[FeishuExtractor] Successfully extracted:', article.title)
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
  console.log('[FeishuExtractor] Feishu content script loaded (simplified version)')
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
