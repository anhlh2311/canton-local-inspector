import { JsonView, darkStyles, defaultStyles } from 'react-json-view-lite'
import 'react-json-view-lite/dist/index.css'
import { useAtomValue } from 'jotai'
import { themeAtom } from '@/stores/nodeStore'
import { cn } from '@/lib/utils'

interface JsonViewerProps {
  data: unknown
  className?: string
}

export function JsonViewer({ data, className }: JsonViewerProps) {
  const theme = useAtomValue(themeAtom)
  const baseStyles = theme === 'dark' ? darkStyles : defaultStyles
  const styles = {
    ...baseStyles,
    container: 'bg-transparent font-mono text-sm',
  }

  return (
    <div className={cn("rounded-lg bg-muted/50 p-4 overflow-auto max-h-[600px]", className)}>
      <JsonView data={data as object} style={styles} />
    </div>
  )
}
