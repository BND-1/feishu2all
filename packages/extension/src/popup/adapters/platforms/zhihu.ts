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
  /**
   * Upload image to Zhihu
   * Uses binary upload for authenticated CDN images (like Feishu)
   */
  async uploadImage(url: string, blob: Blob): Promise<ImageUploadResult> {
    await this.setupHeaderRules()
    try {
      this.logger.info(`Uploading image to Zhihu: ${url.substring(0, 80)}`)

      // If blob is provided and not empty, use binary upload
      // This is necessary for images from authenticated CDNs (like Feishu)
      if (blob && blob.size > 0) {
        this.logger.info(`Using binary upload (blob size: ${blob.size})`)
        const imageUrl = await this.uploadImageBinary(blob)
        return {
          url: imageUrl,
          originalUrl: url,
          success: true,
        }
      }

      // Fallback to URL upload for public images
      this.logger.info('Using URL upload (public image)')
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

      this.logger.info(`Image uploaded successfully: ${response.src}`)

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
   * Upload image using binary method (for authenticated CDN images)
   * Based on Wechatsync implementation with OSS V1 signature
   */
  private async uploadImageBinary(blob: Blob): Promise<string> {
    // 1. Calculate image hash (simple hash, not MD5)
    const arrayBuffer = await blob.arrayBuffer()
    const hashArray = Array.from(new Uint8Array(arrayBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    const imageHash = hashHex.substring(0, 32)

    this.logger.debug(`Image hash: ${imageHash}, size: ${blob.size}`)

    // 2. Request upload token
    const headers = await this.zhihuHeaders()
    const tokenResponse = await this.postJson<any>(
      'https://api.zhihu.com/images',
      {
        image_hash: imageHash,
        source: 'article',
      },
      headers
    )

    this.logger.debug('Token response:', JSON.stringify(tokenResponse))

    const uploadFile = tokenResponse.upload_file
    const uploadToken = tokenResponse.upload_token

    if (!uploadFile || !uploadToken) {
      throw new Error('Failed to get upload token from Zhihu')
    }

    // 3. Check if image already exists
    if (uploadFile.state === 1) {
      this.logger.info('Image already exists on Zhihu')
      const objectKey = uploadFile.object_key || uploadFile.image_id
      return `https://pic4.zhimg.com/${objectKey}`
    }

    // 4. Upload to Zhihu OSS with proper signature
    const objectKey = uploadFile.object_key
    const contentType = blob.type || 'application/octet-stream'
    const ossDate = new Date().toUTCString()
    const ossUserAgent = 'aliyun-sdk-js/6.8.0'

    // Build OSS headers (must be sorted alphabetically)
    const ossHeaders: Record<string, string> = {
      'x-oss-date': ossDate,
      'x-oss-security-token': uploadToken.access_token,
      'x-oss-user-agent': ossUserAgent,
    }

    const canonicalizedOSSHeaders = Object.keys(ossHeaders)
      .sort()
      .map(key => `${key}:${ossHeaders[key]}`)
      .join('\n')

    // CanonicalizedResource: /bucket/object-key
    const bucket = 'zhihu-pics'
    const canonicalizedResource = `/${bucket}/${objectKey}`

    // Build string to sign (OSS V1 signature)
    const stringToSign =
      'PUT\n' +
      '\n' +  // Content-MD5 (empty)
      contentType + '\n' +
      ossDate + '\n' +
      canonicalizedOSSHeaders + '\n' +
      canonicalizedResource

    this.logger.debug('OSS stringToSign:', stringToSign)

    // Calculate HMAC-SHA1 signature
    const signature = await this.hmacSha1Base64(uploadToken.access_key, stringToSign)
    const authorization = `OSS ${uploadToken.access_id}:${signature}`

    this.logger.debug('OSS authorization:', authorization)

    // Upload to OSS
    const ossUrl = `${ZHIHU_CONFIG.ossUrl}/${objectKey}`
    this.logger.info(`Uploading to OSS: ${ossUrl}`)

    const uploadHeaders = {
      'Content-Type': contentType,
      'Date': ossDate,
      'Authorization': authorization,
      'x-oss-date': ossDate,
      'x-oss-security-token': uploadToken.access_token,
      'x-oss-user-agent': ossUserAgent,
    }

    const ossResponse = await this.runtime.fetch(ossUrl, {
      method: 'PUT',
      headers: uploadHeaders,
      body: blob,
    })

    if (!ossResponse.ok) {
      const errorText = await ossResponse.text()
      this.logger.error(`OSS upload failed: ${ossResponse.status}`, errorText)
      throw new Error(`OSS upload failed: ${ossResponse.status}`)
    }

    this.logger.info('OSS upload successful')

    // 5. Return image URL
    let finalObjectKey = objectKey
    if (blob.type === 'image/gif') {
      finalObjectKey = objectKey + '.gif'
    }

    return `https://pic4.zhimg.com/${finalObjectKey}`
  }

  /**
   * Calculate HMAC-SHA1 signature and return base64
   */
  private async hmacSha1Base64(key: string, message: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(key)
    const messageData = encoder.encode(message)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
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

      const isDraft = true // Currently always saves as draft
      const articleUrl = `https://zhuanlan.zhihu.com/p/${draftId}${isDraft ? '/edit' : ''}`

      this.logger.info(`Draft created: ${draftId}`)

      return this.createSuccessResult(String(draftId), articleUrl, isDraft)
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
