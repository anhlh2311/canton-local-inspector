import { JsonView, darkStyles, defaultStyles } from 'react-json-view-lite'
import 'react-json-view-lite/dist/index.css'
import { cn } from '@/lib/utils'

interface JsonViewerProps {
  data: unknown
  className?: string
}

export function JsonViewer({ data, className }: JsonViewerProps) {
  const isDark = document.documentElement.classList.contains('dark')
  const baseStyles = isDark ? darkStyles : defaultStyles
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
