/**
 * Zhihu Platform Adapter
 * Handles authentication, image upload, and article publishing to Zhihu (Zhuanlan)
 */

import { CodeAdapter } from '../code-adapter'
import type {
  Article,
  SyncResult,
  AuthResult,
  ImageUploadResult,
  PlatformConfig,
  Logger,
} from '../../../types'
import { createLogger } from '../../lib/logger'
import runtime from '../../runtime/extension'
import md5 from 'js-md5'

// Zhihu Configuration
const ZHIHU_CONFIG = {
  baseUrl: 'https://www.zhihu.com',
  apiUrl: 'https://zhuanlan.zhihu.com/api',
  ossUrl: 'https://zhihu-pics-upload.zhimg.com',
  ossBucket: 'zhihu-pics',
}

export const ZHIHU_PLATFORM_CONFIG: PlatformConfig = {
  id: 'zhihu',
  name: 'Zhihu',
  icon: '🧠',
  enabled: true,
  requireAuth: true,
  supportMarkdown: true,
  supportCover: true,
  supportTags: true,
  maxTitleLength: 100,
}

// Zhihu API Response Types
interface ZhihuMeResponse {
  id?: string | number
  name?: string
  avatar_url?: string
  url?: string
}

interface ZhihuDraftResponse {
  id?: string
  url?: string
  title?: string
  content?: string
}

interface ZhihuError {
  error?: {
    code?: number
    message?: string
  }
}

export class ZhihuAdapter extends CodeAdapter {
  private readonly logger: Logger
  private xsrfToken: string = ''

  constructor() {
    super(ZHIHU_PLATFORM_CONFIG, createLogger('Zhihu'), ZHIHU_CONFIG.baseUrl)
    this.logger = createLogger('Zhihu')
  }

  /**
   * Check if URL is a Zhihu URL (for image filtering)
   */
  isPlatformUrl(url: string): boolean {
    return (
      url.includes('zhihu.com') ||
      url.includes('zhimg.com') ||
      url.includes('zhihu-pics-upload')
    )
  }

  /**
   * Get platform credentials including XSRF token
   */
  async getCredentials(): Promise<Record<string, any>> {
    const cookies = await this.getCookieCredentials()

    // Get XSRF token
    this.xsrfToken = cookies['_xsrf'] || cookies['XSRF-TOKEN'] || ''

    if (!this.xsrfToken) {
      throw new Error('Not authenticated with Zhihu. Please login first.')
    }

    return {
      cookies,
      xsrfToken: this.xsrfToken,
    }
  }

  /**
   * Check authentication status
   */
  async checkAuth(): Promise<AuthResult> {
    try {
      this.logger.info('Checking Zhihu authentication...')

      const credentials = await this.getCredentials()

      const response = await this.apiRequest<ZhihuMeResponse | ZhihuError>(
        `${ZHIHU_CONFIG.apiUrl}/v4/me`,
        {
          headers: {
            'x-xsrftoken': credentials.xsrfToken,
            'x-zse-93': '101_3_3.0',
          },
        }
      )

      if ('id' in response && response.id) {
        return {
          isAuthenticated: true,
          username: response.name || '',
          userId: String(response.id),
          avatar: response.avatar_url || '',
        }
      }

      if ('error' in response && response.error) {
        return {
          isAuthenticated: false,
          error: response.error.message || 'Authentication failed',
        }
      }

      return {
        isAuthenticated: false,
        error: 'Unknown authentication error',
      }
    } catch (error) {
      this.logger.error('Zhihu auth check failed:', error)
      return {
        isAuthenticated: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Make authenticated API request
   */
  protected async apiRequest<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : endpoint

    const credentials = await this.getCredentials()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-xsrftoken': credentials.xsrfToken,
      'x-zse-93': '101_3_3.0',
      ...options.headers as Record<string, string>,
    }

    const response = await runtime.fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    })

    if (!response.ok) {
      const errorText = await response.text()
      try {
        const errorJson = JSON.parse(errorText)
        if (errorJson.error?.message) {
          throw new Error(`Zhihu API error: ${errorJson.error.message}`)
        }
      } catch {
        // ignore JSON parse errors
      }
      throw new Error(`Zhihu API error: ${response.status}\n${errorText}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Upload image to Zhihu OSS
   */
  async uploadImage(url: string, blob: Blob): Promise<ImageUploadResult> {
    try {
      this.logger.debug(`Uploading image to Zhihu: ${url}`)

      // Get file hash
      const buffer = await blob.arrayBuffer()
      const hash = md5(new Uint8Array(buffer))
      const fileKey = `${hash}.${this.getExtensionFromMimeType(blob.type)}`

      // Method 1: Try URL-based upload first (simpler)
      try {
        const urlResult = await this.uploadImageByUrl(url, fileKey)
        return urlResult
      } catch (urlError) {
        this.logger.debug('URL upload failed, trying binary upload:', urlError)
      }

      // Method 2: Binary upload to OSS
      this.progress('Uploading image to Zhihu OSS...', 50)

      const ossUploadUrl = `${ZHIHU_CONFIG.ossUrl}/v1/${ZHIHU_CONFIG.ossBucket}/${fileKey}`

      // Generate OSS signature
      const signature = await this.generateOSSSignature('PUT', fileKey, blob.type)

      const uploadResponse = await fetch(ossUploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': blob.type,
          'Content-MD5': hash,
          'Authorization': signature,
          'x-oss-object-acl': 'public-read',
        },
        body: blob,
      })

      if (!uploadResponse.ok) {
        throw new Error(`OSS upload failed: ${uploadResponse.statusText}`)
      }

      const imageUrl = `https://picx.zhimg.com/${fileKey}_source.png?source=1940ef5c`

      this.logger.debug(`Image uploaded successfully: ${imageUrl}`)

      return {
        url: imageUrl,
        originalUrl: url,
        success: true,
      }
    } catch (error) {
      this.logger.error(`Failed to upload image to Zhihu: ${url}`, error)
      return {
        url,
        originalUrl: url,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Upload image by URL (Zhihu can fetch from URL)
   */
  private async uploadImageByUrl(originalUrl: string, fileKey: string): Promise<ImageUploadResult> {
    const response = await this.apiRequest<{ url?: string }>(
      `${ZHIHU_CONFIG.apiUrl}/v1/images/upload_url`,
      {
        method: 'POST',
        body: JSON.stringify({
          url: originalUrl,
        }),
      }
    )

    if (!response.url) {
      throw new Error('No image URL returned')
    }

    return {
      url: response.url,
      originalUrl,
      success: true,
    }
  }

  /**
   * Generate OSS signature for image upload
   */
  private async generateOSSSignature(
    method: string,
    key: string,
    contentType: string
  ): Promise<string> {
    const date = new Date().toUTCString()
    const authString = `${method}\n\n\n${date}\nx-oss-object-acl:public-read\n/${ZHIHU_CONFIG.ossBucket}/${key}`

    // Zhihu uses HMAC-SHA1 for OSS
    const signature = await runtime.hmacSha1(authString, 'your_oss_access_key')

    return `OSS ${'your_oss_access_id'}:${signature}`
  }

  /**
   * Pre-process article for Zhihu
   */
  protected async preprocessArticle(article: Article): Promise<Article> {
    let { html, markdown } = article

    // Clean HTML for Zhihu
    if (html) {
      html = this.preprocessHtmlForZhihu(html)
    }

    // Pre-process markdown
    markdown = this.preprocessMarkdownForZhihu(markdown)

    return {
      ...article,
      html,
      markdown,
    }
  }

  /**
   * Pre-process HTML for Zhihu's Draft.js format
   */
  private preprocessHtmlForZhihu(html: string): string {
    let cleaned = this.cleanHtml(html)

    // Wrap images in figure tags for Zhihu
    cleaned = cleaned.replace(/<img([^>]+)>/g, '<figure><img$1></figure>')

    // Convert code blocks to Zhihu format
    cleaned = cleaned.replace(
      /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g,
      '<pre><code class="language-$1">$2</code></pre>'
    )

    return cleaned
  }

  /**
   * Pre-process markdown for Zhihu
   */
  private preprocessMarkdownForZhihu(markdown: string): string {
    // Ensure proper spacing
    let processed = markdown

    // Fix code blocks
    processed = processed.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || 'text'
      return `\n\`\`\`${language}\n${code.trim()}\n\`\`\`\n`
    })

    // Fix table format
    processed = this.fixMarkdownTables(processed)

    return processed
  }

  /**
   * Fix markdown tables for Zhihu
   */
  private fixMarkdownTables(markdown: string): string {
    // Zhihu requires tables to have proper spacing
    return markdown.replace(
      /(\|.+\|\n\|[-|\s]+\|\n(?:\|.+\|\n?)+)/g,
      (match) => {
        return '\n\n' + match.trim() + '\n\n'
      }
    )
  }

  /**
   * Publish article to Zhihu
   */
  protected async publishArticle(article: Article): Promise<SyncResult> {
    try {
      this.logger.info(`Publishing article to Zhihu: ${article.title}`)

      // Step 1: Create draft
      this.progress('Creating draft...', 50)

      const createResponse = await this.apiRequest<ZhihuDraftResponse | ZhihuError>(
        `${ZHIHU_CONFIG.apiUrl}/articles/drafts`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: article.title,
            content: article.markdown,
            delta_time: Date.now(),
          }),
        }
      )

      if ('error' in createResponse && createResponse.error) {
        return this.createErrorResult(
          createResponse.error.message || 'Failed to create draft'
        )
      }

      if (!createResponse.id) {
        return this.createErrorResult('No draft ID returned')
      }

      const draftId = createResponse.id

      // Step 2: Update draft with full content
      this.progress('Updating draft content...', 80)

      await this.apiRequest(
        `${ZHIHU_CONFIG.apiUrl}/articles/${draftId}/draft`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: article.title,
            content: article.markdown,
            summary: article.summary || this.extractPlainText(article.html || '', 100),
          }),
        }
      )

      const draftUrl = `https://zhuanlan.zhihu.com/p/${draftId}`

      this.logger.info(`Draft created: ${draftId}`)

      return this.createSuccessResult(String(draftId), draftUrl, true)
    } catch (error) {
      this.logger.error('Failed to publish article to Zhihu:', error)
      return this.createErrorResult(
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}

export default ZhihuAdapter
