/**
 * Platform Adapter Base Class
 * All platform adapters must extend this class
 */

import type {
  Article,
  SyncResult,
  AuthResult,
  PlatformConfig,
  ImageUploadResult,
  AdapterOptions,
  Logger,
} from '../../types'
import type { RuntimeInterface } from '../runtime/extension'

export abstract class BaseAdapter {
  public readonly config: PlatformConfig
  protected readonly logger: Logger
  protected readonly baseUrl: string
  protected readonly runtime: RuntimeInterface
  protected options: AdapterOptions = {}

  constructor(config: PlatformConfig, logger: Logger, baseUrl: string, runtime: RuntimeInterface) {
    this.config = config
    this.logger = logger
    this.baseUrl = baseUrl
    this.runtime = runtime
  }

  /**
   * Set adapter options
   */
  setOptions(options: AdapterOptions): void {
    this.options = options
  }

  /**
   * Report progress
   */
  protected progress(message: string, progress?: number): void {
    this.options.onProgress?.(message, progress)
  }

  /**
   * Report image upload progress
   */
  protected imageProgress(current: number, total: number): void {
    this.options.onImageProgress?.(current, total)
  }

  /**
   * Check if user is authenticated on the platform
   */
  abstract checkAuth(): Promise<AuthResult>

  /**
   * Upload image to the platform
   */
  abstract uploadImage(url: string, blob: Blob): Promise<ImageUploadResult>

  /**
   * Get platform-specific credentials (cookies, tokens, etc.)
   */
  abstract getCredentials(): Promise<Record<string, any>>

  /**
   * Platform-specific article publishing
   */
  protected abstract publishArticle(article: Article): Promise<SyncResult>

  /**
   * Check if a URL belongs to this platform (for image filtering)
   */
  isPlatformUrl(url: string): boolean {
    return false
  }

  /**
   * Get credentials from cookies
   */
  protected async getCookieCredentials(): Promise<Record<string, string>> {
    const cookies = await this.runtime.getCookies(this.baseUrl)
    const credentials: Record<string, string> = {}
    for (const cookie of cookies) {
      credentials[cookie.name] = cookie.value
    }
    return credentials
  }

  // ============ Shared HTTP methods ============

  /**
   * GET request with credentials
   */
  protected async get<T = any>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.runtime.fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers,
    })
    return this.parseResponse<T>(response)
  }

  /**
   * POST request with JSON body
   */
  protected async postJson<T = any>(
    url: string,
    data: Record<string, unknown>,
    headers?: Record<string, string>
  ): Promise<T> {
    const response = await this.runtime.fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(data),
    })
    return this.parseResponse<T>(response)
  }

  /**
   * POST request with URL-encoded form body
   */
  protected async postForm<T = any>(
    url: string,
    data: Record<string, string>,
    headers?: Record<string, string>
  ): Promise<T> {
    const response = await this.runtime.fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams(data),
    })
    return this.parseResponse<T>(response)
  }

  /**
   * PATCH request with JSON body
   */
  protected async patchJson<T = any>(
    url: string,
    data: Record<string, unknown>,
    headers?: Record<string, string>
  ): Promise<T> {
    const response = await this.runtime.fetch(url, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(data),
    })
    return this.parseResponse<T>(response)
  }

  /**
   * Parse HTTP response — tries JSON, falls back to text
   */
  protected async parseResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }
    const text = await response.text()
    if (!text || text.trim() === '') {
      return {} as T
    }
    try {
      return JSON.parse(text) as T
    } catch {
      return text as unknown as T
    }
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
    }
    return extensions[mimeType] || 'jpg'
  }

  /**
   * Extract plain text from markdown for summary (no DOM dependency)
   */
  protected extractPlainText(markdown: string, maxLength = 200): string {
    // Remove markdown formatting
    let text = markdown
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`[^`]+`/g, '') // Remove inline code
      .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
      .replace(/\[([^\]]+)\]\(.*?\)/g, '$1') // Convert links to text
      .replace(/#{1,6}\s+/g, '') // Remove headers
      .replace(/[*_~]+/g, '') // Remove emphasis
      .replace(/>\s+/g, '') // Remove blockquotes
      .replace(/[-+*]\s+/g, '') // Remove list markers
      .replace(/\d+\.\s+/g, '') // Remove numbered list markers
      .replace(/\s+/g, ' ') // Clean up whitespace
      .trim()

    return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '')
  }

  /**
   * Extract image URLs from HTML <img> tags
   */
  protected extractImageUrlsFromHtml(html: string): string[] {
    const urls: string[] = []
    const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi
    let match
    while ((match = imgRegex.exec(html)) !== null) {
      const url = match[1]
      if (url && !url.startsWith('data:') && !urls.includes(url)) {
        urls.push(url)
      }
    }
    return urls
  }

  /**
   * Extract image URLs from markdown
   */
  protected extractImageUrlsFromMarkdown(markdown: string): string[] {
    const urls: string[] = []
    const imageRegex = /!\[.*?\]\((.*?)\)/g
    let match
    while ((match = imageRegex.exec(markdown)) !== null) {
      const url = match[1]
      if (url && !urls.includes(url)) {
        urls.push(url)
      }
    }
    return urls
  }

  /**
   * Replace image URLs in markdown
   */
  protected replaceImageUrls(
    content: string,
    replacements: ImageUploadResult[]
  ): string {
    let result = content
    for (const replacement of replacements) {
      if (replacement.success && replacement.url !== replacement.originalUrl) {
        const escaped = replacement.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        result = result.replace(new RegExp(escaped, 'g'), replacement.url)

        // Also replace HTML-entity-encoded version (& → &amp;) for HTML content
        const htmlEncoded = replacement.originalUrl.replace(/&/g, '&amp;')
        if (htmlEncoded !== replacement.originalUrl) {
          const escapedHtml = htmlEncoded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          result = result.replace(new RegExp(escapedHtml, 'g'), replacement.url)
        }
      }
    }
    return result
  }

  /**
   * Process and upload all images in the article.
   * Uses a dedup Map to avoid re-uploading the same image,
   * and 300ms throttle between uploads to avoid rate limiting.
   */
  protected async processImages(
    article: Article,
    imageUrls: string[]
  ): Promise<ImageUploadResult[]> {
    const results: ImageUploadResult[] = []
    const uploadedMap = new Map<string, ImageUploadResult>()
    let processed = 0

    for (const url of imageUrls) {
      try {
        // Skip if already a platform URL
        if (this.isPlatformUrl(url)) {
          const result: ImageUploadResult = { url, originalUrl: url, success: true }
          results.push(result)
          continue
        }

        // Dedup: check if we already uploaded this URL
        const cached = uploadedMap.get(url)
        if (cached) {
          results.push({ ...cached, originalUrl: url })
          processed++
          this.imageProgress(processed, imageUrls.length)
          continue
        }

        // Download image: prefer pre-downloaded data URI from content script (for authenticated CDN)
        let blob: Blob = new Blob()
        const dataUri = article.imageDataMap?.[url]
        if (dataUri) {
          try {
            const resp = await fetch(dataUri)
            blob = await resp.blob()
            this.logger.debug(`Using pre-downloaded image for: ${url.substring(0, 60)}...`)
          } catch (e) {
            this.logger.warn(`Failed to decode pre-downloaded image, trying direct download: ${url}`)
          }
        }
        if (blob.size === 0) {
          try {
            const response = await this.runtime.fetch(url, { credentials: 'include' })
            if (response.ok) {
              blob = await response.blob()
            } else {
              this.logger.warn(`Failed to download image (${response.status}), trying upload with URL only: ${url}`)
            }
          } catch (dlError) {
            this.logger.warn(`Image download error, trying upload with URL only: ${url}`, dlError)
          }
        }

        const result = await this.uploadImage(url, blob)
        results.push(result)
        uploadedMap.set(url, result)

        processed++
        this.imageProgress(processed, imageUrls.length)

        // Throttle between uploads to avoid rate limiting
        if (processed < imageUrls.length) {
          await new Promise((r) => setTimeout(r, 300))
        }
      } catch (error) {
        this.logger.error(`Failed to process image ${url}:`, error)
        results.push({
          url,
          originalUrl: url,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return results
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

      // Extract image URLs from both HTML and Markdown, merge and deduplicate
      const htmlImageUrls = article.html ? this.extractImageUrlsFromHtml(article.html) : []
      const mdImageUrls = this.extractImageUrlsFromMarkdown(article.markdown)
      const imageUrls = [...new Set([...htmlImageUrls, ...mdImageUrls])]
      this.logger.info(`Found ${imageUrls.length} images to process (${htmlImageUrls.length} from HTML, ${mdImageUrls.length} from markdown)`)

      let finalMarkdown = article.markdown
      let finalHtml = article.html
      if (imageUrls.length > 0) {
        this.progress('Processing images...', 10)
        const uploadResults = await this.processImages(article, imageUrls)

        // Replace image URLs in both markdown and html
        finalMarkdown = this.replaceImageUrls(finalMarkdown, uploadResults)
        if (finalHtml) {
          finalHtml = this.replaceImageUrls(finalHtml, uploadResults)
        }

        // Check for failed uploads
        const failed = uploadResults.filter((r) => !r.success)
        if (failed.length > 0) {
          this.logger.warn(`${failed.length} images failed to upload`)
        }
      }

      // Create updated article
      const updatedArticle: Article = {
        ...article,
        markdown: finalMarkdown,
        html: finalHtml,
      }

      // Publish to platform
      this.progress(`Publishing to ${this.config.name}...`, 80)
      return await this.publishArticle(updatedArticle)
    } catch (error) {
      this.logger.error(`Publish to ${this.config.name} failed:`, error)
      return this.createErrorResult(
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  /**
   * Create a successful sync result
   */
  protected createSuccessResult(
    postId: string,
    postUrl: string,
    draftOnly = false
  ): SyncResult {
    return {
      platform: this.config.id,
      success: true,
      postId,
      postUrl,
      draftOnly,
      timestamp: Date.now(),
    }
  }

  /**
   * Create a failed sync result
   */
  protected createErrorResult(error: string): SyncResult {
    return {
      platform: this.config.id,
      success: false,
      error,
      timestamp: Date.now(),
    }
  }
}