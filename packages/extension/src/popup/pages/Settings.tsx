/**
 * Settings Page Component
 * Platform configuration and settings
 */

import type { PlatformConfig } from '../../types'

interface SettingsPageProps {
  platforms: PlatformConfig[]
  onUpdate: (config: PlatformConfig[]) => void
  onBack: () => void
}

export default function SettingsPage({ platforms, onUpdate, onBack }: SettingsPageProps) {
  const togglePlatform = (platformId: string) => {
    const updated = platforms.map((p) =>
      p.id === platformId ? { ...p, enabled: !p.enabled } : p
    )
    onUpdate(updated)
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>
        <h2 className="text-lg font-semibold text-gray-800">设置</h2>
        <div className="w-12" /> {/* Spacer for center alignment */}
      </div>

      {/* Platform Settings */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700">同步平台</h3>
          <p className="text-xs text-gray-500 mt-1">
            启用或禁用目标平台
          </p>
        </div>

        <div className="divide-y divide-gray-100">
          {platforms.map((platform) => (
            <div
              key={platform.id}
              className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{platform.icon}</span>
                <div>
                  <h4 className="text-sm font-medium text-gray-800">{platform.name}</h4>
                  <p className="text-xs text-gray-500">
                    {platform.supportMarkdown ? '支持 Markdown' : ''}
                    {platform.supportMarkdown && platform.supportCover ? ' • ' : ''}
                    {platform.supportCover ? '支持封面' : ''}
                  </p>
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={platform.enabled}
                  onChange={() => togglePlatform(platform.id)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Info Section */}
      <div className="mt-4 bg-blue-50 rounded-lg border border-blue-200 p-4">
        <div className="flex gap-3">
          <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">使用提示</p>
            <ul className="space-y-1 text-blue-700">
              <li>• 同步前请确保已登录目标平台</li>
              <li>• 文章将保存为草稿，可手动发布</li>
              <li>• 图片会自动上传到目标平台</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Version Info */}
      <div className="mt-4 text-center text-xs text-gray-500">
        <p>飞书文章同步助手 v1.0.0</p>
        <p className="mt-1">
          支持平台: 飞书知识库/文档 → CSDN、知乎
        </p>
      </div>
    </div>
  )
}
