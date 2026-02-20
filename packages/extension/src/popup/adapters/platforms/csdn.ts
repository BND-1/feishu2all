/**
 * CSDN Platform Adapter
 * Handles authentication, image upload, and article publishing to CSDN
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
import { processHtml, csdnPreset } from '../../lib/html-processor'

// CSDN Configuration
const CSDN_CONFIG = {
  baseUrl: 'https://editor.csdn.net',
  apiUrl: 'https://bizapi.csdn.net',
  mpApiUrl: 'https://mp-action.csdn.net', // New API endpoint
  apiKey: '203803574',
  apiSecret: '9znpamsyl2c7cdrr9sas0le9vbc3r6ba',
  imageService: 'https://imgservice.csdn.net',
}

export const CSDN_PLATFORM_CONFIG: PlatformConfig = {
  id: 'csdn',
  name: 'CSDN',
  icon: '📝',
  enabled: true,
  requireAuth: true,
  supportMarkdown: true,
  supportCover: true,
  supportTags: true,
  maxTitleLength: 100,
}

// CSDN API Response Types
interface CSDNBaseInfoResponse {
  code?: number
  data?: {
    nickName?: string
    avatar?: string
    userName?: string
    id?: string | number
  }
}

interface CSDNSaveArticleResponse {
  code?: number
  data?: {
    id?: string
  }
  message?: string
}

interface CSDNImageSignatureResponse {
  code?: number
  data?: {
    filePath?: string
    host?: string
    accessId?: string
    signature?: string
    policy?: string
    callbackUrl?: string
    callbackBody?: string
    callbackBodyType?: string
    customParam?: {
      rtype?: string
      filePath?: string
      isAudit?: number
      'x-image-app'?: string
      type?: string
      'x-image-suffix'?: string
      username?: string
    }
  }
}

export class CSDNAdapter extends BaseAdapter {
  private headerRuleIds: number[] = []

  constructor(runtime: RuntimeInterface) {
    super(CSDN_PLATFORM_CONFIG, createLogger('CSDN'), CSDN_CONFIG.apiUrl, runtime)
  }

  /**
   * Set up declarativeNetRequest rules to inject Origin/Referer headers
   * Required for CSDN API and Huawei Cloud OBS CORS
   */
  private async setupHeaderRules(): Promise<void> {
    if (this.headerRuleIds.length > 0) {
      this.logger.debug('Header rules already set up:', this.headerRuleIds)
      return
    }

    this.logger.info('Setting up header rules for CSDN and Huawei OBS...')

    const editorHeaders = {
      'Origin': 'https://editor.csdn.net',
      'Referer': 'https://editor.csdn.net/',
    }

    const [r1, r2, r3] = await Promise.all([
      this.runtime.addHeaderRule('*://bizapi.csdn.net/*', editorHeaders),
      this.runtime.addHeaderRule('*://imgservice.csdn.net/*', editorHeaders),
      this.runtime.addHeaderRule('*://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com/*', editorHeaders),
    ])

    this.headerRuleIds = [r1, r2, r3]
    this.logger.info('Header rules added successfully:', this.headerRuleIds)
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
   * Check if URL is a CSDN URL (for image filtering)
   */
  isPlatformUrl(url: string): boolean {
    return url.includes('csdn.net') || url.includes('csdnimg.cn')
  }

  /**
   * Get platform credentials
   */
  async getCredentials(): Promise<Record<string, any>> {
    const cookies = await this.getCookieCredentials()

    // Check for required auth cookies
    const hasAuthCookies = cookies['UserInfo'] || cookies['AU'] || cookies['UN']

    if (!hasAuthCookies) {
      throw new Error('Not authenticated with CSDN. Please login first.')
    }

    return {
      cookies,
      headers: {
        'X-Ca-Key': CSDN_CONFIG.apiKey,
      },
    }
  }

  /**
   * Check authentication status
   */
  async checkAuth(): Promise<AuthResult> {
    try {
      this.logger.info('Checking CSDN authentication...')

      const response = await this.signedRequest<CSDNBaseInfoResponse>(
        '/blog-console-api/v3/editor/getBaseInfo',
        'GET'
      )

      if (response.code === 200 && response.data?.nickName) {
        return {
          isAuthenticated: true,
          username: response.data.nickName,
          userId: String(response.data.userName || response.data.id || ''),
          avatar: response.data.avatar || '',
        }
      }

      return {
        isAuthenticated: false,
        error: response.code ? `Code: ${response.code}` : 'Unknown error',
      }
    } catch (error) {
      this.logger.error('CSDN auth check failed:', error)
      return {
        isAuthenticated: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Generate HMAC-SHA256 signature for CSDN API (Base64 encoded)
   */
  private async generateSignature(
    method: string,
    path: string,
    contentType: string,
    nonce: string
  ): Promise<string> {
    // Build signature string according to CSDN/Alibaba Cloud CA format
    // Format: METHOD\nAccept\nContent-MD5\nContent-Type\n\nHeaders\nPath
    const accept = '*/*'
    const contentMd5 = '' // Empty for CSDN
    const headers = `x-ca-key:${CSDN_CONFIG.apiKey}\nx-ca-nonce:${nonce}`

    const stringToSign = [
      method.toUpperCase(),
      accept,
      contentMd5,
      contentType,
      '',
      headers,
      path,
    ].join('\n')

    this.logger.debug('Signature string:', stringToSign)

    // Generate HMAC-SHA256 and encode as Base64
    const signature = await this.hmacSha256Base64(stringToSign, CSDN_CONFIG.apiSecret)

    this.logger.debug('Generated signature:', signature.substring(0, 20) + '...')

    return signature
  }

  /**
   * Generate HMAC-SHA256 signature and return Base64 encoded string
   */
  private async hmacSha256Base64(message: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const messageData = encoder.encode(message)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)

    // Convert to Base64
    const bytes = new Uint8Array(signature)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }


  /**
   * Make signed API request
   */
  private async signedRequest<T = any>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any
  ): Promise<T> {
    const url = `${CSDN_CONFIG.apiUrl}${endpoint}`

    this.logger.info(`Request URL: ${url}`)
    this.logger.info(`Request method: ${method}`)

    // Generate nonce and signature
    const nonce = this.runtime.generateUUID()
    const contentType = method === 'POST' ? 'application/json' : ''
    const signature = await this.generateSignature(method, endpoint, contentType, nonce)

    // Build headers
    const headers: Record<string, string> = {
      'accept': '*/*',
      'x-ca-key': CSDN_CONFIG.apiKey,
      'x-ca-nonce': nonce,
      'x-ca-signature': signature,
      'x-ca-signature-headers': 'x-ca-key,x-ca-nonce',
    }

    if (method === 'POST') {
      headers['content-type'] = 'application/json'
    }

    this.logger.debug(`Request: ${method} ${endpoint}`)

    const response = await this.runtime.fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      credentials: 'include', // Include cookies
    })

    if (!response.ok) {
      const errorText = await response.text()
      this.logger.error(`API error: ${response.status}`, errorText)
      throw new Error(`CSDN API error: ${response.status}\n${errorText}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Upload image to CSDN
   */
  async uploadImage(url: string, blob: Blob): Promise<ImageUploadResult> {
    await this.setupHeaderRules()
    try {
      this.logger.debug(`Uploading image to CSDN: ${url}`)

      // Step 1: Get upload signature
      this.progress('Getting upload signature...', 0)

      const ext = this.getExtensionFromMimeType(blob.type)

      const sigResponse = await this.signedRequest<CSDNImageSignatureResponse>(
        '/resource-api/v1/image/direct/upload/signature',
        'POST',
        {
          imageTemplate: '',
          appName: 'direct_blog_markdown',
          imageSuffix: ext,
        }
      )

      this.logger.debug('Signature response:', JSON.stringify(sigResponse))

      if (!sigResponse.data?.signature) {
        this.logger.error('Signature response missing data:', sigResponse)
        throw new Error(`Failed to get upload signature: ${JSON.stringify(sigResponse)}`)
      }

      const { host, accessId, signature, policy, filePath, callbackUrl, callbackBody, callbackBodyType, customParam } = sigResponse.data

      // Step 2: Upload to Huawei Cloud OBS
      this.progress('Uploading image...', 50)

      const formData = new FormData()
      formData.append('key', filePath || '')
      formData.append('policy', policy || '')
      formData.append('signature', signature)
      formData.append('AccessKeyId', accessId || '')
      if (callbackUrl) formData.append('callbackUrl', callbackUrl)
      if (callbackBody) formData.append('callbackBody', callbackBody)
      if (callbackBodyType) formData.append('callbackBodyType', callbackBodyType)
      if (customParam) {
        for (const [k, v] of Object.entries(customParam)) {
          if (v != null) formData.append(`x:${k}`, String(v))
        }
      }
      formData.append('file', blob, `image.${ext}`)

      const uploadResponse = await this.runtime.fetch(host || '', {
        method: 'POST',
        body: formData,
      })

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text()
        this.logger.error('OBS upload failed:', uploadResponse.status, errorText)
        throw new Error(`Image upload failed: ${uploadResponse.status}`)
      }

      const uploadResult = await uploadResponse.json()
      const imageUrl = uploadResult?.data?.imageUrl || uploadResult?.imageUrl
        || (host && filePath ? `${host}/${filePath}` : null)

      if (!imageUrl) {
        throw new Error('No image URL returned')
      }

      this.logger.debug(`Image uploaded successfully: ${imageUrl}`)

      return {
        url: imageUrl,
        originalUrl: url,
        success: true,
      }
    } catch (error) {
      this.logger.error(`Failed to upload image to CSDN: ${url}`, error)
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
   * Publish article to CSDN
   */
  protected async publishArticle(article: Article): Promise<SyncResult> {
    try {
      this.logger.info(`Publishing article to CSDN: ${article.title}`)

      // Ensure tags exist (CSDN requires at least one tag)
      let tags = (article.tags?.map((t) => t.trim()).filter(Boolean) || []).join(',')
      if (!tags) {
        // Use default tag if no tags provided
        tags = '技术文章'
        this.logger.warn('No tags provided, using default tag: 技术文章')
      }

      // Build article payload - CSDN API format
      const payload = {
        title: article.title,
        markdowncontent: article.markdown,
        content: article.html ? processHtml(article.html, csdnPreset) : '',
        description: article.summary || this.extractPlainText(article.markdown, 200),
        readType: 'private', // Keep as private/draft, not public
        tags,
        status: 0, // 0 = draft, 2 = published
        categories: '',
        type: 'original',
        originalLink: article.source?.url || '',
        authorizedStatus: false,
        checkOriginal: false,
        source: 'pc_mdeditor',
        createdTime: Date.now(),
        pubStatus: 'draft', // Explicitly set as draft
        coverType: article.cover ? 1 : 0,
        coverImages: article.cover ? [article.cover] : [],
      }

      this.progress('Saving article to CSDN...', 90)

      console.log('[CSDN] Full payload:', JSON.stringify(payload))

      const response = await this.signedRequest<CSDNSaveArticleResponse>(
        '/blog-console-api/v3/mdeditor/saveArticle',
        'POST',
        payload
      )

      console.log('[CSDN] Full response:', JSON.stringify(response))

      if (response.code === 200 && response.data?.id) {
        const articleId = response.data.id
        const draftUrl = `https://editor.csdn.net/md/?articleId=${articleId}`

        this.logger.info(`Article saved as draft: ${articleId}`)

        return this.createSuccessResult(articleId, draftUrl, true)
      }

      return this.createErrorResult(
        response.message || `Failed to save article (code: ${response.code})`
      )
    } catch (error) {
      this.logger.error('Failed to publish article to CSDN:', error)
      return this.createErrorResult(
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}

export default CSDNAdapter
