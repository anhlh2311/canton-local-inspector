import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ActiveContract } from '@/types/canton'

type ExportFormat = 'json' | 'csv'

interface ExportButtonProps {
  contracts: ActiveContract[]
  filename?: string
}

function flattenContract(c: ActiveContract): Record<string, string> {
  const evt = c?.contractEntry?.JsActiveContract?.createdEvent
  if (!evt) return {}
  return {
    contractId: evt.contractId ?? '',
    templateId: evt.templateId ?? '',
    packageName: evt.packageName ?? '',
    signatories: (evt.signatories ?? []).join('; '),
    observers: (evt.observers ?? []).join('; '),
    createArgument: JSON.stringify(evt.createArgument ?? {}),
  }
}

function exportJSON(contracts: ActiveContract[], filename: string) {
  const data = contracts.map((c) => {
    const evt = c?.contractEntry?.JsActiveContract?.createdEvent
    return evt ? {
      contractId: evt.contractId,
      templateId: evt.templateId,
      packageName: evt.packageName,
      signatories: evt.signatories,
      observers: evt.observers,
      createArgument: evt.createArgument,
    } : null
  }).filter(Boolean)

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `${filename}.json`)
}

function exportCSV(contracts: ActiveContract[], filename: string) {
  const rows = contracts.map(flattenContract)
  if (rows.length === 0) return

  const headers = Object.keys(rows[0])
  const csvLines = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => {
        const val = row[h] ?? ''
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`
        }
        return val
      }).join(',')
    ),
  ]

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' })
  downloadBlob(blob, `${filename}.csv`)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function ExportButton({ contracts, filename = 'contracts' }: ExportButtonProps) {
  const [format, setFormat] = useState<ExportFormat>('json')

  if (contracts.length === 0) return null

  const handleExport = () => {
    if (format === 'json') exportJSON(contracts, filename)
    else exportCSV(contracts, filename)
  }

  return (
    <div className="flex items-center gap-1">
      <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
        <SelectTrigger className="h-7 w-[80px] text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="json">JSON</SelectItem>
          <SelectItem value="csv">CSV</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExport}>
        <Download className="h-3 w-3" />
        Export
      </Button>
    </div>
  )
}
