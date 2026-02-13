/**
 * HTML Processing Utilities
 * Core functions for HTML to Markdown conversion
 */

import TurndownService from 'turndown'
import { processHtml } from './html-processor'

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

  // Handle code blocks
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
    replacement: (content: string) => '`' + content + '`',
  })

  // Handle images
  turndown.addRule('image', {
    filter: 'IMG',
    replacement: (content: string, node: HTMLElement) => {
      const alt = node.getAttribute('alt') || ''
      const src = node.getAttribute('src') || ''
      if (!src) return alt || ''
      const title = node.getAttribute('title')
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
  return turndown.turndown(html).trim()
}

/**
 * Clean HTML for publishing — delegates to shared processor
 */
export function cleanHtml(html: string): string {
  return processHtml(html, {
    removeScripts: true,
    removeComments: true,
    removeDataAttributes: true,
    removeEmptyLines: true,
    collapseWhitespace: true,
  })
}

/**
 * Process code blocks in HTML
 */
export function processCodeBlocks(html: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  const codeBlocks = tempDiv.querySelectorAll('pre code, pre.code')
  codeBlocks.forEach((block) => {
    const pre = block.parentElement as HTMLElement
    // Try to detect language
    const classList = block.className.split(' ')
    for (const cls of classList) {
      const match = cls.match(/(?:language-|lang-)(\w+)/)
      if (match) {
        pre.setAttribute('data-language', match[1])
        break
      }
    }
  })

  return tempDiv.innerHTML
}

/**
 * Process images in HTML - handle lazy loading
 */
export function processImages(html: string): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  const images = tempDiv.querySelectorAll('img')
  images.forEach((img) => {
    // Handle lazy loading attributes
    const dataSrc =
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src')

    if (dataSrc && !img.getAttribute('src')) {
      img.setAttribute('src', dataSrc)
    }

    // Clean up unnecessary attributes
    img.removeAttribute('data-src')
    img.removeAttribute('data-original')
    img.removeAttribute('data-lazy-src')
    img.removeAttribute('loading')
  })

  return tempDiv.innerHTML
}

/**
 * Find main article content using heuristics
 */
export function findArticleContent(doc: Document): HTMLElement | null {
  // Common article selectors
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
  ]

  for (const selector of selectors) {
    const element = doc.querySelector(selector)
    if (element) return element as HTMLElement
  }

  // Fallback: find div with most paragraphs
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
 * Extract article metadata
 */
export interface ArticleMetadata {
  title?: string
  description?: string
  cover?: string
}

export function extractMetadata(doc: Document): ArticleMetadata {
  const metadata: ArticleMetadata = {}

  // Title
  metadata.title =
    doc.querySelector('h1')?.textContent?.trim() ||
    doc.querySelector('[property="og:title"]')?.getAttribute('content') ||
    doc.querySelector('title')?.textContent?.trim()

  // Description
  metadata.description =
    doc.querySelector('[property="og:description"]')?.getAttribute('content') ||
    doc.querySelector('[name="description"]')?.getAttribute('content')

  // Cover image
  metadata.cover =
    doc.querySelector('[property="og:image"]')?.getAttribute('content') ||
    doc.querySelector('[name="og:image"]')?.getAttribute('content')

  return metadata
}

// Export default instance
export default {
  htmlToMarkdown,
  cleanHtml,
  processCodeBlocks,
  processImages,
  findArticleContent,
  extractMetadata,
}