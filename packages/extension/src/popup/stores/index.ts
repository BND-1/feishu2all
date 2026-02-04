/**
 * Global State Store (Zustand)
 * For future use if needed
 */

import { create } from 'zustand'

interface AppState {
  // Add state as needed
  isInitialized: boolean
  setIsInitialized: (value: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  isInitialized: false,
  setIsInitialized: (value) => set({ isInitialized: value }),
}))

export default useStore
