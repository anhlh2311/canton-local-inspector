import { useAtom } from 'jotai'
import { useEffect } from 'react'
import { themeAtom, type Theme } from '@/stores/nodeStore'

export function useTheme() {
  const [theme, setTheme] = useAtom(themeAtom)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev: Theme) => (prev === 'dark' ? 'light' : 'dark'))
  }

  return { theme, setTheme, toggleTheme }
}
