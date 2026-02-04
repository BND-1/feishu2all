/**
 * Generic Article Extractor
 * Uses Safari Reader-style heuristics to extract article content from any web page
 */

import type { Article } from '../types'
import { htmlToMarkdown, cleanHtml, processCodeBlocks, processImages, extractMetadata, findArticleContent } from '../popup/lib/html'

export class ArticleExtractor {
  /**
   * Extract article from current page
   */
  static extractFromCurrentPage(): Article | null {
    try {
      // Get document info
      const url = window.location.href
      const doc = document.documentElement.cloneNode(true) as Document

      // Extract metadata
      const metadata = extractMetadata(doc)

      // Find article content
      const contentNode = findArticleContent(doc)

      if (!contentNode) {
        console.warn('[ArticleExtractor] No article content found')
        return null
      }

      // Get HTML content
      let html = contentNode.innerHTML

      // Clean and process HTML
      html = cleanHtml(html)
      html = processCodeBlocks(html)
      html = processImages(html)

      // Convert to markdown
      const markdown = htmlToMarkdown(html)

      // Build article object
      const article: Article = {
        title: metadata.title || 'Untitled',
        markdown,
        html,
        cover: metadata.cover,
        summary: metadata.description,
        source: {
          url,
          platform: this.detectPlatform(url),
        },
      }

      // Extract images
      const images = this.extractImages(html)
      if (images.length > 0) {
        article.images = images
      }

      return article
    } catch (error) {
      console.error('[ArticleExtractor] Extraction failed:', error)
      return null
    }
  }

  /**
   * Extract images from HTML
   */
  private static extractImages(html: string): string[] {
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = html

    const images: string[] = []
    const imgElements = tempDiv.querySelectorAll('img')

    imgElements.forEach((img) => {
      const src = img.getAttribute('src')
      if (src && src.startsWith('http')) {
        images.push(src)
      }
    })

    return [...new Set(images)] // Deduplicate
  }

  /**
   * Detect platform from URL
   */
  private static detectPlatform(url: string): string {
    try {
      const hostname = new URL(url).hostname.toLowerCase()

      if (hostname.includes('feishu.cn') || hostname.includes('feishu.com')) {
        return 'feishu'
      }
      if (hostname.includes('csdn.net')) {
        return 'csdn'
      }
      if (hostname.includes('zhihu.com')) {
        return 'zhihu'
      }
      if (hostname.includes('juejin.cn')) {
        return 'juejin'
      }
      if (hostname.includes('weixin.qq.com')) {
        return 'weixin'
      }
    } catch {
      // ignore URL parse errors
    }

    return 'unknown'
  }

  /**
   * Extract article from HTML string
   */
  static extractFromHtml(html: string, url: string): Article | null {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')

      // Extract metadata
      const metadata = extractMetadata(doc)

      // Find article content
      const contentNode = findArticleContent(doc)

      if (!contentNode) {
        console.warn('[ArticleExtractor] No article content found in HTML')
        return null
      }

      // Get HTML content
      let contentHtml = contentNode.innerHTML

      // Clean and process HTML
      contentHtml = cleanHtml(contentHtml)
      contentHtml = processCodeBlocks(contentHtml)
      contentHtml = processImages(contentHtml)

      // Convert to markdown
      const markdown = htmlToMarkdown(contentHtml)

      // Build article object
      const article: Article = {
        title: metadata.title || 'Untitled',
        markdown,
        html: contentHtml,
        cover: metadata.cover,
        summary: metadata.description,
        source: {
          url,
          platform: this.detectPlatform(url),
        },
      }

      // Extract images
      const images = this.extractImages(contentHtml)
      if (images.length > 0) {
        article.images = images
      }

      return article
    } catch (error) {
      console.error('[ArticleExtractor] HTML extraction failed:', error)
      return null
    }
  }

  /**
   * Validate extracted article
   */
  static validateArticle(article: Article): boolean {
    if (!article.title || article.title.trim().length === 0) {
      console.warn('[ArticleExtractor] Article has no title')
      return false
    }

    if (!article.markdown || article.markdown.trim().length < 50) {
      console.warn('[ArticleExtractor] Article content too short')
      return false
    }

    return true
  }
}

// Export for content script usage
export default ArticleExtractor
