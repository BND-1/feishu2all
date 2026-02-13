/**
 * Zhihu Platform Adapter
 * Handles authentication, image upload, and article publishing to Zhihu (Zhuanlan)
 */

import { BaseAdapter } from '../base'
import type {
  Article,
  SyncResult,
  AuthResult,
  ImageUploadResult,
  PlatformConfig,
} from '../../../types'
import { createLogger } from '../../lib/logger'
import type { RuntimeInterface } from '../../runtime/extension'
import { processHtml, zhihuPreset } from '../../lib/html-processor'

// Zhihu Configuration
const ZHIHU_CONFIG = {
  baseUrl: 'https://www.zhihu.com',
  apiUrl: 'https://zhuanlan.zhihu.com/api',
  editorUrl: 'https://zhuanlan.zhihu.com/api/articles', // Correct endpoint
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

interface ZhihuImageUploadResponse {
  src?: string
  hash?: string
  error?: {
    code?: number
    message?: string
  }
}

export class ZhihuAdapter extends BaseAdapter {
  private xsrfToken: string = ''
  private headerRuleIds: number[] = []

  constructor(runtime: RuntimeInterface) {
    super(ZHIHU_PLATFORM_CONFIG, createLogger('Zhihu'), ZHIHU_CONFIG.baseUrl, runtime)
  }

  /**
   * Set up declarativeNetRequest rules for Zhihu API
   */
  private async setupHeaderRules(): Promise<void> {
    if (this.headerRuleIds.length > 0) return

    const ruleHeaders = { 'x-requested-with': 'fetch' }

    const [r1, r2, r3] = await Promise.all([
      this.runtime.addHeaderRule('*://www.zhihu.com/api/*', ruleHeaders),
      this.runtime.addHeaderRule('*://zhuanlan.zhihu.com/api/*', ruleHeaders),
      this.runtime.addHeaderRule('*://api.zhihu.com/*', ruleHeaders),
    ])

    this.headerRuleIds = [r1, r2, r3]
    this.logger.debug('Header rules added:', this.headerRuleIds)
  }

  /**
   * Clear dynamic header rules
   */
  private async clearHeaderRules(): Promise<void> {
    if (this.headerRuleIds.length === 0) return
    await this.runtime.removeHeaderRules(this.headerRuleIds)
    this.headerRuleIds = []
    this.logger.debug('Header rules cleared')
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

    // Debug: Log all cookies to see what's available
    this.logger.debug('Available cookies:', Object.keys(cookies).join(', '))

    // Get XSRF token - try multiple possible names
    this.xsrfToken = cookies['_xsrf'] || cookies['XSRF-TOKEN'] || cookies['xsrf'] || ''

    // Also check for session cookies
    const hasSession = cookies['z_c0'] || cookies['d_c0']

    if (!this.xsrfToken && !hasSession) {
      this.logger.error('No XSRF token or session cookies found')
      throw new Error('Not authenticated with Zhihu. Please login to zhihu.com first.')
    }

    if (!this.xsrfToken) {
      this.logger.warn('No XSRF token found, but session cookie exists. Attempting to continue...')
      // Some operations might work without XSRF token
      this.xsrfToken = ''
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

      const headers = await this.zhihuHeaders({ 'x-zse-93': '101_3_3.0' })

      const response = await this.get<ZhihuMeResponse | ZhihuError>(
        `${ZHIHU_CONFIG.apiUrl}/v4/me`,
        headers
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
   * Build Zhihu-specific headers (Referer, Origin, XSRF token)
   */
  private async zhihuHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
    const credentials = await this.getCredentials()
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://zhuanlan.zhihu.com/',
      'Origin': 'https://zhuanlan.zhihu.com',
      ...extra,
    }
    if (credentials.xsrfToken) {
      headers['x-xsrftoken'] = credentials.xsrfToken
    }
    return headers
  }

  /**
   * Upload image to Zhihu via URL fetch
   */
  async uploadImage(url: string, blob: Blob): Promise<ImageUploadResult> {
    await this.setupHeaderRules()
    try {
      this.logger.debug(`Uploading image to Zhihu: ${url}`)

      const headers = await this.zhihuHeaders({ 'x-requested-with': 'fetch' })
      const response = await this.postForm<ZhihuImageUploadResponse>(
        `${ZHIHU_CONFIG.apiUrl}/uploaded_images`,
        { url, source: 'article' },
        headers
      )

      if (response.error?.message) {
        throw new Error(`Zhihu image upload failed: ${response.error.message}`)
      }

      if (!response.src) {
        throw new Error('No image URL returned from Zhihu')
      }

      this.logger.debug(`Image uploaded to Zhihu: ${response.src}`)

      return {
        url: response.src,
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
    } finally {
      await this.clearHeaderRules()
    }
  }

  /**
   * Publish article to Zhihu
   */
  protected async publishArticle(article: Article): Promise<SyncResult> {
    await this.setupHeaderRules()
    try {
      this.logger.info(`Publishing article to Zhihu: ${article.title}`)

      // Step 1: Create draft
      this.progress('Creating draft...', 50)

      // Zhihu requires HTML content (Draft.js editor), not markdown
      const htmlContent = article.html
        ? processHtml(article.html, zhihuPreset)
        : article.markdown

      const headers = await this.zhihuHeaders()
      const createResponse = await this.postJson<ZhihuDraftResponse | ZhihuError>(
        `${ZHIHU_CONFIG.apiUrl}/articles/drafts`,
        { title: article.title, content: htmlContent, delta_time: Date.now() },
        headers
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

      await this.patchJson(
        `${ZHIHU_CONFIG.apiUrl}/articles/${draftId}/draft`,
        {
          title: article.title,
          content: htmlContent,
          summary: article.summary || this.extractPlainText(article.markdown, 100),
        },
        headers
      )

      const draftUrl = `https://zhuanlan.zhihu.com/p/${draftId}`

      this.logger.info(`Draft created: ${draftId}`)

      return this.createSuccessResult(String(draftId), draftUrl, true)
    } catch (error) {
      this.logger.error('Failed to publish article to Zhihu:', error)
      return this.createErrorResult(
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      await this.clearHeaderRules()
    }
  }
}

export default ZhihuAdapter
