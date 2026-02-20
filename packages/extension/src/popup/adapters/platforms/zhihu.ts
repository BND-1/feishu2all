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
import md5 from 'js-md5'

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
    // 1. Calculate MD5 hash of the image
    const arrayBuffer = await blob.arrayBuffer()
    const imageHash = md5(arrayBuffer)

    this.logger.debug(`Image MD5 hash: ${imageHash}, size: ${blob.size}`)

    // 2. Request upload token (minimal headers, matching Wechatsync)
    const tokenResponse = await this.runtime.fetch('https://api.zhihu.com/images', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_hash: imageHash, source: 'article' }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      this.logger.error('Token request failed:', tokenResponse.status, errorText)
      throw new Error(`Failed to get upload token: ${tokenResponse.status}`)
    }

    const tokenData = await tokenResponse.json() as {
      upload_file: { state: number; image_id: string; object_key: string }
      upload_token: { access_id: string; access_key: string; access_token: string }
    }

    this.logger.debug('Token response:', JSON.stringify(tokenData))

    const uploadFile = tokenData.upload_file
    const uploadToken = tokenData.upload_token

    if (!uploadFile || !uploadToken) {
      throw new Error('Failed to get upload token from Zhihu')
    }

    // 3. Check if image already exists
    if (uploadFile.state === 1) {
      this.logger.info('Image already exists on Zhihu')
      const imgDetail = await this.waitForImageReady(uploadFile.image_id)
      return `https://pic4.zhimg.com/${imgDetail.original_hash}`
    }

    // 4. Upload to Zhihu OSS
    await this.ossUpload(uploadFile.object_key, blob, uploadToken)

    // 5. Return image URL
    let objectKey = uploadFile.object_key
    if (blob.type === 'image/gif') {
      objectKey = objectKey + '.gif'
    }

    return `https://pic4.zhimg.com/${objectKey}`
  }

  /**
   * Wait for image processing to complete on Zhihu
   */
  private async waitForImageReady(imageId: string): Promise<{ original_hash: string }> {
    for (let i = 0; i < 10; i++) {
      const response = await this.runtime.fetch(`https://api.zhihu.com/images/${imageId}`, {
        credentials: 'include',
      })
      const data = await response.json() as { status?: string; original_hash?: string }

      if (data.status === 'completed' || data.original_hash) {
        return data as { original_hash: string }
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error('Image processing timeout')
  }

  /**
   * Upload to Zhihu OSS with V1 signature
   */
  private async ossUpload(
    objectKey: string,
    blob: Blob,
    token: { access_id: string; access_key: string; access_token: string }
  ): Promise<void> {
    const contentType = blob.type || 'application/octet-stream'
    const ossDate = new Date().toUTCString()
    const ossUserAgent = 'aliyun-sdk-js/6.8.0'

    // Build CanonicalizedOSSHeaders (sorted alphabetically)
    const ossHeaders: Record<string, string> = {
      'x-oss-date': ossDate,
      'x-oss-security-token': token.access_token,
      'x-oss-user-agent': ossUserAgent,
    }

    const canonicalizedOSSHeaders = Object.keys(ossHeaders)
      .sort()
      .map(key => `${key}:${ossHeaders[key]}`)
      .join('\n')

    const canonicalizedResource = `/zhihu-pics/${objectKey}`

    // Build string to sign (OSS V1 signature)
    const stringToSign =
      'PUT\n' +
      '\n' +  // Content-MD5 (empty)
      contentType + '\n' +
      ossDate + '\n' +
      canonicalizedOSSHeaders + '\n' +
      canonicalizedResource

    const signature = await this.hmacSha1Base64(token.access_key, stringToSign)
    const authorization = `OSS ${token.access_id}:${signature}`

    const ossUrl = `${ZHIHU_CONFIG.ossUrl}/${objectKey}`
    this.logger.info(`Uploading to OSS: ${ossUrl}`)

    // Add header rule for OSS CORS
    const ossRuleId = await this.runtime.addHeaderRule(
      '*://zhihu-pics-upload.zhimg.com/*',
      { 'Origin': 'https://zhuanlan.zhihu.com', 'Referer': 'https://zhuanlan.zhihu.com/' }
    )

    try {
      const ossResponse = await this.runtime.fetch(ossUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Date': ossDate,
          'Authorization': authorization,
          'x-oss-date': ossDate,
          'x-oss-security-token': token.access_token,
          'x-oss-user-agent': ossUserAgent,
        },
        body: blob,
      })

      if (!ossResponse.ok) {
        const errorText = await ossResponse.text()
        this.logger.error(`OSS upload failed: ${ossResponse.status}`, errorText)
        throw new Error(`OSS upload failed: ${ossResponse.status}`)
      }

      this.logger.info('OSS upload successful')
    } finally {
      await this.runtime.removeHeaderRules([ossRuleId])
    }
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
