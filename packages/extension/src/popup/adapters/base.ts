/**
 * Base Adapter Interface
 * All platform adapters must extend this base class
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

export abstract class BaseAdapter {
  public readonly config: PlatformConfig
  protected readonly logger: Logger
  protected options: AdapterOptions = {}

  constructor(config: PlatformConfig, logger: Logger) {
    this.config = config
    this.logger = logger
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
   * Publish/sync article to the platform
   */
  abstract publish(article: Article): Promise<SyncResult>

  /**
   * Upload image to the platform
   */
  abstract uploadImage(url: string, blob: Blob): Promise<ImageUploadResult>

  /**
   * Get platform-specific credentials (cookies, tokens, etc.)
   */
  abstract getCredentials(): Promise<Record<string, any>>

  /**
   * Check if a URL belongs to this platform (for image filtering)
   */
  isPlatformUrl(url: string): boolean {
    return false
  }

  /**
   * Pre-process article before publishing
   */
  protected async preprocessArticle(article: Article): Promise<Article> {
    return article
  }

  /**
   * Extract and upload all images in the article
   */
  protected async processImages(
    article: Article,
    imageUrls: string[]
  ): Promise<ImageUploadResult[]> {
    const results: ImageUploadResult[] = []
    let processed = 0

    for (const url of imageUrls) {
      try {
        // Skip if already a platform URL
        if (this.isPlatformUrl(url)) {
          results.push({
            url,
            originalUrl: url,
            success: true,
          })
          continue
        }

        // Download image
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Failed to download image: ${response.statusText}`)
        }
        const blob = await response.blob()

        // Upload to platform
        const result = await this.uploadImage(url, blob)
        results.push(result)

        processed++
        this.imageProgress(processed, imageUrls.length)
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
   * Replace image URLs in markdown
   */
  protected replaceImageUrls(
    markdown: string,
    replacements: ImageUploadResult[]
  ): string {
    let result = markdown
    for (const replacement of replacements) {
      if (replacement.success && replacement.url !== replacement.originalUrl) {
        // Replace in markdown image syntax
        result = result.replace(
          new RegExp(replacement.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          replacement.url
        )
      }
    }
    return result
  }

  /**
   * Replace image URLs in HTML
   */
  protected replaceImageUrlsInHtml(
    html: string,
    replacements: ImageUploadResult[]
  ): string {
    let result = html
    for (const replacement of replacements) {
      if (replacement.success && replacement.url !== replacement.originalUrl) {
        result = result.replace(
          new RegExp(`(["'])${replacement.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g'),
          `$1${replacement.url}$1`
        )
      }
    }
    return result
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
   * Extract image URLs from HTML
   */
  protected extractImageUrlsFromHtml(html: string): string[] {
    const urls: string[] = []
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi
    let match

    while ((match = imgRegex.exec(html)) !== null) {
      const url = match[1]
      if (url && !urls.includes(url)) {
        urls.push(url)
      }
    }

    return urls
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
