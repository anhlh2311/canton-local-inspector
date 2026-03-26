import { JsonView, darkStyles } from 'react-json-view-lite'
import 'react-json-view-lite/dist/index.css'
import { cn } from '@/lib/utils'

interface JsonViewerProps {
  data: unknown
  className?: string
}

const customStyles = {
  ...darkStyles,
  container: 'bg-transparent font-mono text-sm',
}

export function JsonViewer({ data, className }: JsonViewerProps) {
  return (
    <div className={cn("rounded-lg bg-muted/50 p-4 overflow-auto max-h-[600px]", className)}>
      <JsonView data={data as object} style={customStyles} />
    </div>
  )
}
