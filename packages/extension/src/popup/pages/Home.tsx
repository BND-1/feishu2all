/**
 * Home Page Component
 * Main page for article preview and sync
 */

import { useState } from 'react'
import type { Article, SyncResult, PlatformConfig } from '../../types'

interface HomePageProps {
  article: Article | null
  syncResults: SyncResult[]
  isSyncing: boolean
  syncProgress: string
  platforms: PlatformConfig[]
  currentUrl: string
  onExtract: () => void
  onSync: (platforms: string[]) => void
  onRefresh: () => void
}

export default function HomePage({
  article,
  syncResults,
  isSyncing,
  syncProgress,
  platforms,
  currentUrl,
  onExtract,
  onSync,
  onRefresh,
}: HomePageProps) {
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [showPreview, setShowPreview] = useState(false)

  const isFeishuUrl = currentUrl && /https?:\/\/[^.]+\.feishu\.cn\/(wiki|docs|docx)/.test(currentUrl)

  const togglePlatform = (platformId: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platformId)
        ? prev.filter((id) => id !== platformId)
        : [...prev, platformId]
    )
  }

  const handleSync = () => {
    if (selectedPlatforms.length > 0) {
      onSync(selectedPlatforms)
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* URL Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isFeishuUrl ? (
              <div className="w-2 h-2 rounded-full bg-green-500" />
            ) : (
              <div className="w-2 h-2 rounded-full bg-yellow-500" />
            )}
            <span className="text-sm text-gray-600">
              {isFeishuUrl ? '当前页面是飞书文档' : '请在飞书文档页面使用'}
            </span>
          </div>
          {isFeishuUrl && (
            <button
              onClick={onRefresh}
              className="text-sm text-blue-600 hover:text-blue-700 transition-colors"
            >
              刷新
            </button>
          )}
        </div>
      </div>

      {/* Article Preview */}
      {article ? (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Cover Image */}
          {article.cover && (
            <div className="aspect-video bg-gray-100 overflow-hidden">
              <img
                src={article.cover}
                alt="Cover"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Article Info */}
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-800 mb-2 line-clamp-2">
              {article.title}
            </h2>

            {article.summary && (
              <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                {article.summary}
              </p>
            )}

            {/* Stats */}
            <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
              <span>{article.markdown?.length || 0} 字符</span>
              {article.images?.length > 0 && <span>{article.images.length} 图片</span>}
              {article.source && (
                <span className="truncate max-w-[150px]">
                  来源: {article.source.platform}
                </span>
              )}
            </div>

            {/* Preview Toggle */}
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="text-sm text-blue-600 hover:text-blue-700 transition-colors"
            >
              {showPreview ? '隐藏预览' : '显示预览'}
            </button>

            {/* Markdown Preview */}
            {showPreview && (
              <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200 max-h-[200px] overflow-auto">
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
                  {article.markdown?.slice(0, 500)}
                  {article.markdown && article.markdown.length > 500 && '...'}
                </pre>
              </div>
            )}
          </div>
        </div>
      ) : isFeishuUrl ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <svg
            className="w-12 h-12 text-gray-400 mx-auto mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-gray-600 mb-4">点击下方按钮提取文章内容</p>
          <button
            onClick={onExtract}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            提取文章
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <svg
            className="w-12 h-12 text-yellow-500 mx-auto mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <p className="text-gray-600">
            请在飞书文档页面打开插件
            <br />
            <span className="text-sm text-gray-500">
              支持 *.feishu.cn/wiki/* 、docs/* 、docx/*
            </span>
          </p>
        </div>
      )}

      {/* Platform Selection */}
      {article && !isSyncing && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">选择同步平台</h3>
          <div className="space-y-2">
            {platforms.map((platform) => (
              <label
                key={platform.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedPlatforms.includes(platform.id)}
                  onChange={() => togglePlatform(platform.id)}
                  disabled={!platform.enabled}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xl">{platform.icon}</span>
                <span className="text-sm font-medium text-gray-700">{platform.name}</span>
                {!platform.enabled && (
                  <span className="text-xs text-gray-500">(未启用)</span>
                )}
              </label>
            ))}
          </div>

          <button
            onClick={handleSync}
            disabled={selectedPlatforms.length === 0}
            className="w-full mt-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
          >
            同步到 {selectedPlatforms.length} 个平台
          </button>
        </div>
      )}

      {/* Syncing State */}
      {isSyncing && (
        <div className="bg-white rounded-lg border border-blue-200 p-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-600 spinner" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-sm text-gray-700">{syncProgress || '同步中...'}</span>
          </div>
        </div>
      )}

      {/* Sync Results */}
      {syncResults.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">同步结果</h3>
          <div className="space-y-2">
            {syncResults.map((result, index) => (
              <div
                key={index}
                className={`p-3 rounded-lg border ${
                  result.success
                    ? 'border-green-200 bg-green-50'
                    : 'border-red-200 bg-red-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {result.success ? (
                        <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      )}
                      <span className="text-sm font-medium text-gray-700">
                        {platforms.find((p) => p.id === result.platform)?.name || result.platform}
                      </span>
                      {result.draftOnly && (
                        <span className="text-xs text-gray-500">(草稿)</span>
                      )}
                    </div>
                    {result.error && (
                      <p className="text-xs text-red-600">{result.error}</p>
                    )}
                  </div>
                  {result.postUrl && (
                    <a
                      href={result.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      查看
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
