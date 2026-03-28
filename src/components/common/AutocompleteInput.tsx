import { useState, useRef, useEffect, useCallback } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface AutocompleteOption {
  value: string
  label: string
  sublabel?: string
}

interface AutocompleteInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  options: AutocompleteOption[]
  placeholder?: string
  className?: string
  loading?: boolean
}

export function AutocompleteInput({
  value,
  onChange,
  onSubmit,
  options,
  placeholder,
  className,
  loading,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = value
    ? options.filter(
        (o) =>
          o.value.toLowerCase().includes(value.toLowerCase()) ||
          o.label.toLowerCase().includes(value.toLowerCase()) ||
          (o.sublabel?.toLowerCase().includes(value.toLowerCase()) ?? false)
      )
    : options

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-option]')
      items[highlightIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  const handleSelect = useCallback((opt: AutocompleteOption) => {
    onChange(opt.value)
    setOpen(false)
    setHighlightIndex(-1)
    inputRef.current?.blur()
  }, [onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open || filtered.length === 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setOpen(true)
        setInputFocused(true)
        e.preventDefault()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightIndex >= 0 && highlightIndex < filtered.length) {
          handleSelect(filtered[highlightIndex])
        } else if (onSubmit) {
          setOpen(false)
          onSubmit()
        }
        break
      case 'Escape':
        setOpen(false)
        setHighlightIndex(-1)
        break
    }
  }, [open, filtered, highlightIndex, handleSelect])

  const showDropdown = open && inputFocused && filtered.length > 0

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setHighlightIndex(-1)
          }}
          onFocus={() => {
            setOpen(true)
            setInputFocused(true)
          }}
          onBlur={() => {
            setTimeout(() => setInputFocused(false), 150)
          }}
          onKeyDown={handleKeyDown}
          className="pr-14"
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(''); setOpen(true); setInputFocused(true); setHighlightIndex(-1); inputRef.current?.focus() }}
              className="h-5 w-5 rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => { setOpen(!open); setInputFocused(true); inputRef.current?.focus() }}
            className="h-5 w-5 rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {showDropdown && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-border bg-popover shadow-lg"
        >
          {loading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
          )}
          {filtered.map((opt, i) => (
            <button
              key={opt.value}
              data-option
              role="option"
              aria-selected={i === highlightIndex}
              className={cn(
                "w-full text-left px-3 py-2 transition-colors border-b border-border/30 last:border-0",
                i === highlightIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              )}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlightIndex(i)}
              onClick={() => handleSelect(opt)}
            >
              <p className="text-sm font-medium truncate">{opt.label}</p>
              {opt.sublabel && (
                <p className="text-[10px] text-muted-foreground font-mono truncate">{opt.sublabel}</p>
              )}
            </button>
          ))}
          {!loading && filtered.length === 0 && value && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>
          )}
        </div>
      )}
    </div>
  )
}
