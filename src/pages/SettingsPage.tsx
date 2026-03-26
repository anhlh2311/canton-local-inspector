import { useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Settings, Plus, Trash2, Save, RotateCcw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { nodesAtom, refreshIntervalAtom, selectedNodeIdAtom } from '@/stores/nodeStore'
import { DEFAULT_NODES } from '@/constants/nodes'
import type { NodeConfig } from '@/types/canton'

function NodeConfigCard({
  node,
  onUpdate,
  onDelete,
  isSelected,
}: {
  node: NodeConfig
  onUpdate: (updated: NodeConfig) => void
  onDelete: () => void
  isSelected: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(node)

  const handleSave = () => {
    onUpdate(form)
    setEditing(false)
  }

  return (
    <Card className={isSelected ? 'border-primary' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: node.color }} />
            <span className="font-medium text-sm">{node.name}</span>
            {isSelected && <Badge variant="default" className="text-[10px]">Active</Badge>}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
              {editing ? 'Cancel' : 'Edit'}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Color</label>
                <Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">JSON API URL</label>
                <Input value={form.jsonApiUrl} onChange={(e) => setForm({ ...form, jsonApiUrl: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">JSON API Port</label>
                <Input type="number" value={form.jsonApiPort} onChange={(e) => setForm({ ...form, jsonApiPort: parseInt(e.target.value) })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Validator API URL</label>
                <Input value={form.validatorApiUrl} onChange={(e) => setForm({ ...form, validatorApiUrl: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Validator API Port</label>
                <Input type="number" value={form.validatorApiPort} onChange={(e) => setForm({ ...form, validatorApiPort: parseInt(e.target.value) })} />
              </div>
            </div>
            <Button size="sm" onClick={handleSave}>
              <Save className="h-3.5 w-3.5 mr-1" /> Save
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">JSON API: </span>
              <span className="font-mono">{node.jsonApiUrl}:{node.jsonApiPort}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Validator: </span>
              <span className="font-mono">{node.validatorApiUrl}:{node.validatorApiPort}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Ledger gRPC: </span>
              <span className="font-mono">:{node.ledgerApiPort}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const [nodes, setNodes] = useAtom(nodesAtom)
  const [refreshInterval, setRefreshInterval] = useAtom(refreshIntervalAtom)
  const selectedNodeId = useAtomValue(selectedNodeIdAtom)

  const handleAddNode = () => {
    const newNode: NodeConfig = {
      id: `node-${Date.now()}`,
      name: `Custom Node ${nodes.length + 1}`,
      jsonApiUrl: 'http://localhost',
      jsonApiPort: 5975,
      validatorApiUrl: 'http://localhost',
      validatorApiPort: 5903,
      ledgerApiPort: 5901,
      color: '#64748b',
    }
    setNodes([...nodes, newNode])
  }

  const handleUpdateNode = (index: number, updated: NodeConfig) => {
    const next = [...nodes]
    next[index] = updated
    setNodes(next)
  }

  const handleDeleteNode = (index: number) => {
    setNodes(nodes.filter((_, i) => i !== index))
  }

  const handleReset = () => {
    setNodes(DEFAULT_NODES)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground text-sm mt-1">Configure node connections and preferences</p>
      </div>

      {/* Refresh Interval */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Auto-refresh Interval</label>
            <div className="flex items-center gap-2">
              {[5000, 15000, 30000, 60000, 0].map((ms) => (
                <Button
                  key={ms}
                  variant={refreshInterval === ms ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRefreshInterval(ms)}
                >
                  {ms === 0 ? 'Off' : `${ms / 1000}s`}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Node Configurations */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Node Configurations</h3>
          <p className="text-xs text-muted-foreground">Manage connected Canton participant nodes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
          </Button>
          <Button size="sm" onClick={handleAddNode}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Node
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {nodes.map((node, index) => (
          <NodeConfigCard
            key={node.id}
            node={node}
            isSelected={node.id === selectedNodeId}
            onUpdate={(updated) => handleUpdateNode(index, updated)}
            onDelete={() => handleDeleteNode(index)}
          />
        ))}
      </div>
    </div>
  )
}
