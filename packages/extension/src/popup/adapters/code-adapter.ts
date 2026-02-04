/**
 * Code Platform Adapter
 * Base adapter for developer content platforms (CSDN, Zhihu, etc.)
 * Provides common functionality for code-focused article publishing
 */

import { BaseAdapter } from './base'
import type {
  Article,
  SyncResult,
  AuthResult,
  ImageUploadResult,
  PlatformConfig,
  Logger,
  AdapterOptions,
} from '../../types'
import runtime from '../runtime/extension'

export abstract class CodeAdapter extends BaseAdapter {
  protected readonly baseUrl: string
  protected readonly apiHeaders: Record<string, string> = {}

  constructor(config: PlatformConfig, logger: Logger, baseUrl: string) {
    super(config, logger)
    this.baseUrl = baseUrl
  }

  /**
   * Get credentials from cookies
   */
  protected async getCookieCredentials(): Promise<Record<string, string>> {
    const cookies = await runtime.getCookies(this.baseUrl)
    const credentials: Record<string, string> = {}

    for (const cookie of cookies) {
      credentials[cookie.name] = cookie.value
    }

    return credentials
  }

  /**
   * Make authenticated API request
   */
  protected async apiRequest<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}${endpoint}`

    const response = await runtime.fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...this.apiHeaders,
        ...options.headers,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API request failed: ${response.status} ${response.statusText}\n${errorText}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Check authentication by making an API call
   */
  protected async checkAuthByApi<T extends { data?: any; code?: number }>(
    endpoint: string,
    validator: (data: T) => boolean
  ): Promise<AuthResult> {
    try {
      const response = await this.apiRequest<T>(endpoint)

      if (validator(response)) {
        return {
          isAuthenticated: true,
          userId: String((response as any).data?.id || (response as any).data?.userId || ''),
          username: (response as any).data?.username || (response as any).data?.nickName || '',
          avatar: (response as any).data?.avatar || '',
        }
      }

      return {
        isAuthenticated: false,
        error: 'Authentication validation failed',
      }
    } catch (error) {
      this.logger.error(`${this.config.name} auth check failed:`, error)
      return {
        isAuthenticated: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Download image as blob
   */
  protected async downloadImage(url: string): Promise<Blob> {
    const response = await runtime.fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`)
    }
    return response.blob()
  }

  /**
   * Get file extension from content type
   */
  protected getExtensionFromMimeType(mimeType: string): string {
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
    }
    return extensions[mimeType] || 'jpg'
  }

  /**
   * Generate MD5 hash for file upload
   */
  protected async generateMD5(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('MD5', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Clean HTML content for publishing
   */
  protected cleanHtml(html: string): string {
    let cleaned = html

    // Remove script tags
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')

    // Remove style tags
    cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

    // Remove HTML comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')

    // Remove empty divs and spans
    cleaned = cleaned.replace(/<(div|span)\s+[^>]*>\s*<\/\1>/gi, '')

    // Clean up multiple whitespace
    cleaned = cleaned.replace(/\s{2,}/g, ' ')

    return cleaned.trim()
  }

  /**
   * Extract plain text from HTML for summary
   * Uses regex instead of DOM to work in service worker context
   */
  protected extractPlainText(html: string, maxLength = 200): string {
    // Remove script tags
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')

    // Remove style tags
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, '')

    // Remove all HTML tags
    text = text.replace(/<[^>]+>/g, '')

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ')
    text = text.replace(/&lt;/g, '<')
    text = text.replace(/&gt;/g, '>')
    text = text.replace(/&amp;/g, '&')
    text = text.replace(/&quot;/g, '"')
    text = text.replace(/&#39;/g, "'")

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim()

    return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '')
  }

  /**
   * Validate article before publishing
   */
  protected validateArticle(article: Article): { valid: boolean; error?: string } {
    if (!article.title || article.title.trim().length === 0) {
      return { valid: false, error: 'Title is required' }
    }

    if (!article.markdown || article.markdown.trim().length === 0) {
      return { valid: false, error: 'Content is required' }
    }

    if (this.config.maxTitleLength && article.title.length > this.config.maxTitleLength) {
      return {
        valid: false,
        error: `Title must be less than ${this.config.maxTitleLength} characters`,
      }
    }

    return { valid: true }
  }

  /**
   * Publish article with image processing
   */
  async publish(article: Article): Promise<SyncResult> {
    try {
      // Validate article
      const validation = this.validateArticle(article)
      if (!validation.valid) {
        return this.createErrorResult(validation.error || 'Validation failed')
      }

      // Pre-process article
      const processed = await this.preprocessArticle(article)

      // Extract images
      const imageUrls = this.extractImageUrlsFromMarkdown(processed.markdown)
      this.logger.info(`Found ${imageUrls.length} images to process`)

      // Upload images
      let finalMarkdown = processed.markdown
      let finalHtml = processed.html || ''

      if (imageUrls.length > 0) {
        this.progress('Processing images...', 10)
        const uploadResults = await this.processImages(processed, imageUrls)

        // Replace image URLs
        finalMarkdown = this.replaceImageUrls(finalMarkdown, uploadResults)
        finalHtml = processed.html
          ? this.replaceImageUrlsInHtml(processed.html, uploadResults)
          : ''

        // Check for failed uploads
        const failed = uploadResults.filter((r) => !r.success)
        if (failed.length > 0) {
          this.logger.warn(`${failed.length} images failed to upload`)
        }
      }

      // Create updated article
      const updatedArticle: Article = {
        ...processed,
        markdown: finalMarkdown,
        html: finalHtml || undefined,
      }

      // Publish to platform
      this.progress(`Publishing to ${this.config.name}...`, 80)
      const result = await this.publishArticle(updatedArticle)

      return result
    } catch (error) {
      this.logger.error(`Publish to ${this.config.name} failed:`, error)
      return this.createErrorResult(
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  /**
   * Platform-specific article publishing
   */
  protected abstract publishArticle(article: Article): Promise<SyncResult>
}
