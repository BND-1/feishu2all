/**
 * HTML Processor — preset-based HTML transformation pipeline
 * All functions are pure regex (no DOM), safe for Service Worker.
 * Ported from Wechatsync html-processor.ts pattern.
 */

export interface HtmlProcessOptions {
  /** Remove <script> and <style> tags */
  removeScripts?: boolean
  /** Remove HTML comments */
  removeComments?: boolean
  /** Remove <iframe> tags */
  removeIframes?: boolean
  /** Remove SVG images (<img src="*.svg">) */
  removeSvgImages?: boolean
  /** Remove all data-* attributes */
  removeDataAttributes?: boolean
  /** Remove all style attributes */
  removeStyles?: boolean
  /** Remove all class attributes */
  removeClasses?: boolean
  /** Convert <section> to <div> */
  convertSectionToDiv?: boolean
  /** Remove empty paragraphs (<p>/<section> with only whitespace or <br>) */
  removeEmptyLines?: boolean
  /** Remove empty <div> elements (no text, no images) */
  removeEmptyDivs?: boolean
  /** Remove trailing <br> before closing tags */
  removeTrailingBr?: boolean
  /** Process lazy-loaded images (data-src → src) */
  processLazyImages?: boolean
  /** Format code blocks (merge multiple <code> in <pre>) */
  processCodeBlocks?: boolean
  /** Collapse excessive whitespace/newlines */
  collapseWhitespace?: boolean
  /** Wrap standalone <img> in <figure> tags */
  wrapImagesInFigure?: boolean
  /** Compact HTML — remove all whitespace between tags (for Draft.js) */
  compactHtml?: boolean
}

/**
 * Process HTML through a configurable pipeline.
 * Each option enables a specific transformation step.
 * Order of operations is fixed for correctness.
 */
export function processHtml(html: string, options: HtmlProcessOptions = {}): string {
  const original = html
  let result = html

  try {
    if (options.removeScripts) {
      result = removeScripts(result)
    }
    if (options.removeComments) {
      result = removeComments(result)
    }
    if (options.removeIframes) {
      result = removeIframes(result)
    }
    if (options.removeSvgImages) {
      result = removeSvgImages(result)
    }
    if (options.processLazyImages) {
      result = processLazyImages(result)
    }
    if (options.processCodeBlocks) {
      result = processCodeBlocks(result)
    }
    if (options.convertSectionToDiv) {
      result = convertSectionToDiv(result)
    }
    if (options.removeEmptyLines) {
      result = removeEmptyLines(result)
    }
    if (options.removeEmptyDivs) {
      result = removeEmptyDivs(result)
    }
    if (options.removeTrailingBr) {
      result = removeTrailingBr(result)
    }
    if (options.removeStyles) {
      result = removeAttribute(result, 'style')
    }
    if (options.removeDataAttributes) {
      result = removeDataAttributes(result)
    }
    if (options.removeClasses) {
      result = removeAttribute(result, 'class')
    }
    if (options.wrapImagesInFigure) {
      result = wrapImagesInFigure(result)
    }
    if (options.collapseWhitespace) {
      result = collapseWhitespace(result)
    }
    if (options.compactHtml) {
      result = compactHtml(result)
    }
    return result.trim()
  } catch (error) {
    console.error('[HtmlProcessor] Error:', error)
    return original
  }
}

// ============ Transform functions ============

function removeScripts(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
}

function removeComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

function removeIframes(html: string): string {
  return html
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe[^>]*\/?>/gi, '')
}

function removeSvgImages(html: string): string {
  return html
    .replace(/<img[^>]+src=["'][^"']*\.svg[^"']*["'][^>]*\/?>/gi, '')
    .replace(/<img[^>]+src=["']data:image\/svg[^"']*["'][^>]*\/?>/gi, '')
}

function processLazyImages(html: string): string {
  return html.replace(/<img([^>]*)>/gi, (_match, attrs: string) => {
    const lazySrcAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc']
    for (const attr of lazySrcAttrs) {
      const regex = new RegExp(`${attr}=["']([^"']+)["']`, 'i')
      const lazyMatch = attrs.match(regex)
      if (lazyMatch) {
        const lazySrc = lazyMatch[1]
        const srcMatch = attrs.match(/\ssrc=["']([^"']+)["']/i)
        if (srcMatch && !srcMatch[1].startsWith('data:image/svg')) {
          continue
        }
        if (srcMatch) {
          attrs = attrs.replace(/\ssrc=["'][^"']*["']/i, ` src="${lazySrc}"`)
        } else {
          attrs = ` src="${lazySrc}"` + attrs
        }
        break
      }
    }
    return `<img${attrs}>`
  })
}

function processCodeBlocks(html: string): string {
  return html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, content: string) => {
    const codeMatches = content.match(/<code[^>]*>([\s\S]*?)<\/code>/gi)
    if (codeMatches && codeMatches.length > 1) {
      const lines = codeMatches.map((c: string) => {
        const text = c.replace(/<\/?code[^>]*>/gi, '')
        return escapeHtml(text)
      })
      return `<pre><code>${lines.join('\n')}</code></pre>`
    }
    return match
  })
}

function convertSectionToDiv(html: string): string {
  return html
    .replace(/<section(\s[^>]*)?>/gi, '<div$1>')
    .replace(/<\/section>/gi, '</div>')
}

function removeEmptyLines(html: string): string {
  let result = html.replace(/<(p|section)[^>]*>\s*(<br\s*\/?>\s*)*<\/\1>/gi, '')
  result = result.replace(/<(p|section)[^>]*>\s*<\/\1>/gi, '')
  return result
}

function removeEmptyDivs(html: string): string {
  return html.replace(/<div[^>]*>(\s|<br\s*\/?>)*<\/div>/gi, '')
}

function removeTrailingBr(html: string): string {
  return html.replace(/(<br\s*\/?>\s*)+(<\/(p|section|div)>)/gi, '$2')
}

function removeAttribute(html: string, attrName: string): string {
  const regex = new RegExp(`\\s*${attrName}=["'][^"']*["']`, 'gi')
  return html.replace(regex, '')
}

function removeDataAttributes(html: string): string {
  return html.replace(/\s*data-[\w-]+=["'][^"']*["']/gi, '')
}

function wrapImagesInFigure(html: string): string {
  return html.replace(/<img([^>]+)>/g, '<figure><img$1></figure>')
}

function collapseWhitespace(html: string): string {
  let result = html.replace(/\n{3,}/g, '\n\n')
  result = result.replace(/>\s{2,}</g, '>\n<')
  return result
}

function compactHtml(html: string): string {
  return html.replace(/>\s+</g, '><').trim()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ============ Presets ============

/** Feishu extraction cleanup — scripts, comments, lazy images */
export const feishuCleanPreset: HtmlProcessOptions = {
  removeScripts: true,
  removeComments: true,
  processLazyImages: true,
  processCodeBlocks: true,
}

/** Zhihu — aggressive cleanup for Draft.js editor */
export const zhihuPreset: HtmlProcessOptions = {
  removeScripts: true,
  removeComments: true,
  removeIframes: true,
  removeSvgImages: true,
  removeDataAttributes: true,
  convertSectionToDiv: true,
  removeEmptyLines: true,
  removeEmptyDivs: true,
  removeTrailingBr: true,
  processCodeBlocks: true,
  wrapImagesInFigure: true,
  collapseWhitespace: true,
}

/** CSDN — light cleanup, CSDN handles most formatting */
export const csdnPreset: HtmlProcessOptions = {
  removeScripts: true,
  removeComments: true,
  removeIframes: true,
  processLazyImages: true,
}
