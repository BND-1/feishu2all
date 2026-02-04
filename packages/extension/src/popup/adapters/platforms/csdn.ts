/**
 * CSDN Platform Adapter
 * Handles authentication, image upload, and article publishing to CSDN
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
    endpoint?: string
    accessKeyId?: string
    signature?: string
    policy?: string
    objectKey?: string
  }
}

export class CSDNAdapter extends CodeAdapter {
  private readonly logger: Logger

  constructor() {
    super(CSDN_PLATFORM_CONFIG, createLogger('CSDN'), CSDN_CONFIG.apiUrl)
    this.logger = createLogger('CSDN')
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
   * Generate UUID for nonce
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
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
    const nonce = this.generateUUID()
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

    const response = await runtime.fetch(url, {
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
    try {
      this.logger.debug(`Uploading image to CSDN: ${url}`)

      // Step 1: Get upload signature
      this.progress('Getting upload signature...', 0)

      const sigResponse = await this.signedRequest<CSDNImageSignatureResponse>(
        '/resource-api/v1/image/direct/upload/signature',
        'POST',
        {
          fileType: this.getExtensionFromMimeType(blob.type),
        }
      )

      if (!sigResponse.data?.signature) {
        throw new Error('Failed to get upload signature')
      }

      const { endpoint, accessKeyId, signature, policy, objectKey } = sigResponse.data

      // Step 2: Upload to Huawei Cloud OBS
      this.progress('Uploading image...', 50)

      const formData = new FormData()
      formData.append('key', objectKey || '')
      formData.append('policy', policy || '')
      formData.append('x-obs-acl', 'public-read')
      formData.append('AccessKeyId', accessKeyId || '')
      formData.append('signature', signature)
      formData.append('file', blob)

      const uploadResponse = await fetch(endpoint || '', {
        method: 'POST',
        body: formData,
      })

      if (!uploadResponse.ok) {
        throw new Error(`Image upload failed: ${uploadResponse.statusText}`)
      }

      const uploadResult = await uploadResponse.json()
      const imageUrl = uploadResult?.data?.imageUrl || uploadResult?.imageUrl

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
    }
  }

  /**
   * Publish article to CSDN
   */
  protected async publishArticle(article: Article): Promise<SyncResult> {
    try {
      this.logger.info(`Publishing article to CSDN: ${article.title}`)

      // Build article payload - CSDN API format
      const payload = {
        title: article.title,
        markdowncontent: article.markdown,
        content: article.html || '',
        description: article.summary || this.extractPlainText(article.markdown, 200),
        readType: 'public',
        tags: (article.tags?.map((t) => t.trim()).filter(Boolean) || []).join(','),
        status: 0, // 0 = draft
        categories: '',
        type: 'original',
        originalLink: article.source?.url || '',
        authorizedStatus: false,
        checkOriginal: false,
        source: 'pc_mdeditor',
        createdTime: Date.now(),
        pubStatus: 'draft',
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
