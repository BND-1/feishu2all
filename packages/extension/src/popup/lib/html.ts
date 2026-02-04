/**
 * HTML Processing Utilities
 * Functions for cleaning, processing, and extracting content from HTML
 */

import TurndownService from 'turndown'
import { logger } from './logger'

/**
 * Create a configured TurndownService instance
 */
export function createTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })

  // Add custom rules for better code block handling
  turndown.addRule('codeBlock', {
    filter: (node: HTMLElement) => {
      return (
        node.nodeName === 'PRE' &&
        (node.firstChild?.nodeName === 'CODE' || node.classList.contains('code'))
      )
    },
    replacement: (content: string, node: HTMLElement) => {
      const codeNode = node.firstChild as HTMLElement
      const language =
        codeNode?.className.match(/language-(\w+)/)?.[1] ||
        node.getAttribute('data-language') ||
        ''

      return '\n\n```' + language + '\n' + content + '\n```\n\n'
    },
  })

  // Handle inline code
  turndown.addRule('inlineCode', {
    filter: (node: HTMLElement) => {
      return node.nodeName === 'CODE' && node.parentElement?.nodeName !== 'PRE'
    },
    replacement: (content: string) => {
      return '`' + content + '`'
    },
  })

  // Handle tables
  turndown.addRule('table', {
    filter: (node: HTMLElement) => {
      return node.nodeName === 'TABLE'
    },
    replacement: (content: string) => {
      return '\n\n' + content + '\n\n'
    },
  })

  // Handle images with alt text
  turndown.addRule('image', {
    filter: (node: HTMLElement) => {
      return node.nodeName === 'IMG'
    },
    replacement: (content: string, node: HTMLElement) => {
      const alt = node.getAttribute('alt') || ''
      const src = node.getAttribute('src') || ''
      const title = node.getAttribute('title') || ''

      if (!src) {
        return alt || ''
      }

      return `![${alt}](${src}${title ? ` "${title}"` : ''})`
    },
  })

  return turndown
}

/**
 * Singleton TurndownService instance
 */
let turndownInstance: TurndownService | null = null

export function getTurndown(): TurndownService {
  if (!turndownInstance) {
    turndownInstance = createTurndown()
  }
  return turndownInstance
}

/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  const turndown = getTurndown()
  const markdown = turndown.turndown(html)
  return markdown.trim()
}

/**
 * Remove HTML comments
 */
export function removeComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * Remove script and style tags
 */
export function removeScriptsAndStyles(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
}

/**
 * Remove empty elements
 */
export function removeEmptyElements(html: string): string {
  return html
    .replace(/<(div|span|p)\s+[^>]*>\s*<\/\1>/gi, '')
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '<br>')
}

/**
 * Decode HTML entities
 */
export function decodeHtmlEntities(html: string): string {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = html
  return textarea.value
}

/**
 * Extract text content from HTML
 */
export function extractText(html: string, maxLength?: number): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  // Remove script and style elements
  const scriptsAndStyles = tempDiv.querySelectorAll('script, style')
  scriptsAndStyles.forEach((el) => el.remove())

  let text = tempDiv.textContent || tempDiv.innerText || ''
  text = text.replace(/\s+/g, ' ').trim()

  if (maxLength && text.length > maxLength) {
    return text.slice(0, maxLength) + '...'
  }

  return text
}

/**
 * Clean HTML for publishing
 */
export function cleanHtml(html: string): string {
  let cleaned = html

  // Remove comments
  cleaned = removeComments(cleaned)

  // Remove scripts and styles
  cleaned = removeScriptsAndStyles(cleaned)

  // Remove empty elements
  cleaned = removeEmptyElements(cleaned)

  // Remove data attributes
  cleaned = cleaned.replace(/\s+data-[^=]+="[^"]*"/gi, '')

  // Clean up multiple whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ')

  return cleaned.trim()
}

/**
 * Process code blocks in HTML
 */
export function processCodeBlocks(html: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  // Find all code blocks
  const codeBlocks = tempDiv.querySelectorAll('pre code, pre.code, .highlight > pre')

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

    // Check for data-language attribute
    if (!language) {
      language = pre.getAttribute('data-language') || block.getAttribute('data-language') || ''
    }

    // Set data-language for later use
    if (language) {
      pre.setAttribute('data-language', language)
    }
  })

  return tempDiv.innerHTML
}

/**
 * Process images in HTML - handle lazy loading attributes
 */
export function processImages(html: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  const images = tempDiv.querySelectorAll('img')

  images.forEach((img) => {
    // Check for lazy loading attributes
    const dataSrc =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-srcset')?.split(' ')[0]

    if (dataSrc && !img.getAttribute('src')) {
      img.setAttribute('src', dataSrc)
    }

    // Clean up unnecessary attributes
    img.removeAttribute('data-src')
    img.removeAttribute('data-original')
    img.removeAttribute('data-lazy-src')
    img.removeAttribute('loading')
    img.removeAttribute('class')
  })

  return tempDiv.innerHTML
}

/**
 * Extract links from HTML
 */
export function extractLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = []
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  const anchorTags = tempDiv.querySelectorAll('a')

  anchorTags.forEach((a) => {
    const href = a.getAttribute('href')
    const text = a.textContent?.trim()

    if (href && text) {
      links.push({ href, text })
    }
  })

  return links
}

/**
 * Fix relative URLs to absolute URLs
 */
export function fixRelativeUrls(html: string, baseUrl: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  // Fix images
  const images = tempDiv.querySelectorAll('img')
  images.forEach((img) => {
    const src = img.getAttribute('src')
    if (src && !src.startsWith('http') && !src.startsWith('data:')) {
      img.setAttribute('src', new URL(src, baseUrl).href)
    }
  })

  // Fix links
  const links = tempDiv.querySelectorAll('a')
  links.forEach((a) => {
    const href = a.getAttribute('href')
    if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
      a.setAttribute('href', new URL(href, baseUrl).href)
    }
  })

  return tempDiv.innerHTML
}

/**
 * Strip HTML tags, leaving only text
 */
export function stripTags(html: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html
  return tempDiv.textContent || tempDiv.innerText || ''
}

/**
 * Truncate HTML to a maximum character count (preserving tags)
 */
export function truncateHtml(html: string, maxLength: number): string {
  if (html.length <= maxLength) {
    return html
  }

  // Simple approach: truncate at nearest tag boundary
  let truncated = html.slice(0, maxLength)
  const lastOpenTag = truncated.lastIndexOf('<')
  const lastCloseTag = truncated.lastIndexOf('>')

  // If we're in the middle of a tag, close it properly
  if (lastOpenTag > lastCloseTag) {
    truncated = html.slice(0, lastOpenTag)
  }

  return truncated + '...'
}

/**
 * Safari Reader-style article extraction
 * Finds the main content node using heuristics
 */
export function findArticleContent(doc: Document): HTMLElement | null {
  // Common selectors for article content
  const selectors = [
    'article',
    '[role="article"]',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.content',
    '.wiki-content',
    '.doc-content',
    'main',
    '#main',
    '.main',
  ]

  for (const selector of selectors) {
    const element = doc.querySelector(selector)
    if (element) {
      return element as HTMLElement
    }
  }

  // Fallback: find the div with most paragraphs
  const allDivs = doc.querySelectorAll('div')
  let bestDiv: HTMLElement | null = null
  let maxParagraphs = 0

  allDivs.forEach((div) => {
    const paragraphs = div.querySelectorAll('p').length
    if (paragraphs > maxParagraphs) {
      maxParagraphs = paragraphs
      bestDiv = div as HTMLElement
    }
  })

  return bestDiv
}

/**
 * Extract article metadata from HTML
 */
export interface ArticleMetadata {
  title?: string
  description?: string
  cover?: string
  author?: string
  publishTime?: string
  tags?: string[]
}

export function extractMetadata(doc: Document): ArticleMetadata {
  const metadata: ArticleMetadata = {}

  // Title
  const title =
    doc.querySelector('h1')?.textContent?.trim() ||
    doc.querySelector('[property="og:title"]')?.getAttribute('content') ||
    doc.querySelector('title')?.textContent?.trim()
  if (title) metadata.title = title

  // Description
  const description =
    doc.querySelector('[property="og:description"]')?.getAttribute('content') ||
    doc.querySelector('[name="description"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="description"]')?.getAttribute('content')
  if (description) metadata.description = description

  // Cover image
  const cover =
    doc.querySelector('[property="og:image"]')?.getAttribute('content') ||
    doc.querySelector('[name="og:image"]')?.getAttribute('content')
  if (cover) metadata.cover = cover

  // Author
  const author =
    doc.querySelector('[property="author"]')?.getAttribute('content') ||
    doc.querySelector('[name="author"]')?.getAttribute('content') ||
    doc.querySelector('.author')?.textContent?.trim()
  if (author) metadata.author = author

  // Publish time
  const publishTime =
    doc.querySelector('[property="article:published_time"]')?.getAttribute('content') ||
    doc.querySelector('[name="publish_time"]')?.getAttribute('content') ||
    doc.querySelector('time')?.getAttribute('datetime')
  if (publishTime) metadata.publishTime = publishTime

  // Tags
  const tagElements = doc.querySelectorAll('[property="article:tag"], [rel="tag"], .tag')
  if (tagElements.length > 0) {
    metadata.tags = Array.from(tagElements)
      .map((el) => el.getAttribute('content') || el.textContent?.trim())
      .filter(Boolean) as string[]
  }

  return metadata
}

/**
 * Generate a summary from HTML content
 */
export function generateSummary(html: string, maxLength = 200): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  // Find first paragraph
  const firstParagraph = tempDiv.querySelector('p')

  if (firstParagraph) {
    const text = firstParagraph.textContent?.trim() || ''
    return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '')
  }

  // Fallback to first text content
  const textContent = tempDiv.textContent?.trim() || ''
  return textContent.slice(0, maxLength) + (textContent.length > maxLength ? '...' : '')
}

// Export default instance
export default {
  htmlToMarkdown,
  cleanHtml,
  processCodeBlocks,
  processImages,
  extractText,
  extractLinks,
  findArticleContent,
  extractMetadata,
  generateSummary,
  stripTags,
  truncateHtml,
  fixRelativeUrls,
}
