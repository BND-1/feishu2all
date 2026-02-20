/**
 * Main App Component
 */

import { useState, useEffect } from 'react'
import type { Article, SyncResult, PlatformConfig, SyncHistory } from '../types'
import { runtime } from './runtime/extension'
import { createLogger } from './lib/logger'
import HomePage from './pages/Home'
import HistoryPage from './pages/History'
import SettingsPage from './pages/Settings'

const logger = createLogger('App')

type Page = 'home' | 'history' | 'settings'

interface AppState {
  currentPage: Page
  article: Article | null
  syncResults: SyncResult[]
  isSyncing: boolean
  isExtracting: boolean
  syncProgress: string
  platforms: PlatformConfig[]
  history: SyncHistory[]
  currentUrl: string
}

function App() {
  const [state, setState] = useState<AppState>({
    currentPage: 'home',
    article: null,
    syncResults: [],
    isSyncing: false,
    isExtracting: false,
    syncProgress: '',
    platforms: [],
    history: [],
    currentUrl: '',
  })

  useEffect(() => {
    initializeApp()
  }, [])

  const initializeApp = async () => {
    try {
      // Get current tab info
      const [currentTab, config, history] = await Promise.all([
        runtime.getCurrentTab(),
        getStoredConfig(),
        getStoredHistory(),
      ])

      const currentUrl = currentTab?.url || ''

      setState((prev) => ({
        ...prev,
        currentUrl,
        platforms: config,
        history,
      }))
    } catch (error) {
      logger.error('Failed to initialize app:', error)
    }
  }

  const extractArticle = async (url?: string) => {
    try {
      logger.info('Extracting article...')

      // Set extracting state
      setState((prev) => ({ ...prev, isExtracting: true }))

      // Scroll to top before extraction
      await runtime.sendMessage({
        type: 'SCROLL_TO_TOP',
      })

      // Wait for DOM to render after scroll (increased for dynamic content)
      await new Promise(resolve => setTimeout(resolve, 800))

      const response = await runtime.sendMessage<{ article: Article | null; error?: string }>({
        type: 'EXTRACT_ARTICLE',
        url,
      })

      if (response.article) {
        setState((prev) => ({
          ...prev,
          article: response.article,
          isExtracting: false,
        }))

        logger.info('Article extracted successfully')
      } else if (response.error) {
        setState((prev) => ({ ...prev, isExtracting: false }))
        logger.error('Article extraction failed:', response.error)
        alert('提取失败: ' + response.error)
      } else {
        setState((prev) => ({ ...prev, isExtracting: false }))
        logger.error('No article or error in response')
        alert('提取失败: 未获取到文章内容')
      }
    } catch (error) {
      setState((prev) => ({ ...prev, isExtracting: false }))
      logger.error('Failed to extract article:', error)
      const errorMsg = error instanceof Error ? error.message : String(error)

      // Check for common connection errors
      if (errorMsg.includes('Receiving end does not exist') ||
          errorMsg.includes('Could not establish connection')) {
        alert('提取失败: 内容脚本未加载，请刷新页面后重试')
      } else if (errorMsg.includes('message port closed')) {
        alert('提取失败: 页面可能已关闭，请重试')
      } else {
        alert('提取失败: ' + errorMsg)
      }
    }
  }

  const syncArticle = async (selectedPlatforms: string[]) => {
    if (!state.article) {
      logger.warn('No article to sync')
      return
    }

    setState((prev) => ({ ...prev, isSyncing: true, syncProgress: 'Starting sync...' }))

    try {
      const response = await runtime.sendMessage<{ results: SyncResult[] }>({
        type: 'SYNC_ARTICLE',
        article: state.article,
        platforms: selectedPlatforms,
      })

      setState((prev) => ({
        ...prev,
        syncResults: response.results,
        isSyncing: false,
        syncProgress: '',
      }))

      // Add to history
      await addToHistory(state.article, response.results)

      logger.info('Sync completed:', response.results)
    } catch (error) {
      logger.error('Sync failed:', error)
      setState((prev) => ({
        ...prev,
        isSyncing: false,
        syncProgress: '',
      }))
    }
  }

  const getStoredConfig = async (): Promise<PlatformConfig[]> => {
    const stored = await runtime.getStorage('config')
    return stored?.config || [
      {
        id: 'csdn',
        name: 'CSDN',
        icon: '📝',
        enabled: true,
        requireAuth: true,
        supportMarkdown: true,
        supportCover: true,
        supportTags: true,
      },
      {
        id: 'zhihu',
        name: 'Zhihu',
        icon: '🧠',
        enabled: true,
        requireAuth: true,
        supportMarkdown: true,
        supportCover: true,
        supportTags: true,
      },
    ]
  }

  const getStoredHistory = async (): Promise<SyncHistory[]> => {
    const stored = await runtime.getStorage('history')
    return stored?.history || []
  }

  const addToHistory = async (article: Article, results: SyncResult[]) => {
    const entry: SyncHistory = {
      id: Date.now().toString(),
      article,
      results,
      timestamp: Date.now(),
    }

    const updatedHistory = [entry, ...state.history].slice(0, 50) // Keep last 50
    await runtime.setStorage({ history: updatedHistory })

    setState((prev) => ({ ...prev, history: updatedHistory }))
  }

  const clearHistory = async () => {
    await runtime.removeStorage('history')
    setState((prev) => ({ ...prev, history: [] }))
  }

  const updateConfig = async (config: PlatformConfig[]) => {
    await runtime.setStorage({ config })
    setState((prev) => ({ ...prev, platforms: config }))
  }

  const navigateTo = (page: Page) => {
    setState((prev) => ({ ...prev, currentPage: page }))
  }

  const currentPageContent = () => {
    switch (state.currentPage) {
      case 'home':
        return (
          <HomePage
            article={state.article}
            syncResults={state.syncResults}
            isSyncing={state.isSyncing}
            isExtracting={state.isExtracting}
            syncProgress={state.syncProgress}
            platforms={state.platforms}
            currentUrl={state.currentUrl}
            onExtract={() => extractArticle()}
            onSync={(platforms) => syncArticle(platforms)}
            onRefresh={() => extractArticle()}
          />
        )
      case 'history':
        return (
          <HistoryPage
            history={state.history}
            onClear={clearHistory}
            onBack={() => navigateTo('home')}
          />
        )
      case 'settings':
        return (
          <SettingsPage
            platforms={state.platforms}
            onUpdate={updateConfig}
            onBack={() => navigateTo('home')}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="w-[360px] h-[500px] bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">飞书文章同步</h1>
        <nav className="flex gap-1">
          <button
            onClick={() => navigateTo('home')}
            className={`p-2 rounded-lg transition-colors ${
              state.currentPage === 'home'
                ? 'bg-blue-100 text-blue-600'
                : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="首页"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </button>
          <button
            onClick={() => navigateTo('history')}
            className={`p-2 rounded-lg transition-colors ${
              state.currentPage === 'history'
                ? 'bg-blue-100 text-blue-600'
                : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="历史记录"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button
            onClick={() => navigateTo('settings')}
            className={`p-2 rounded-lg transition-colors ${
              state.currentPage === 'settings'
                ? 'bg-blue-100 text-blue-600'
                : 'hover:bg-gray-100 text-gray-600'
            }`}
            title="设置"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </nav>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        {currentPageContent()}
      </main>
    </div>
  )
}

export default App
