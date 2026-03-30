import { useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Settings, Plus, Trash2, Save, RotateCcw, Eye, EyeOff, Globe, Key, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { nodesAtom, refreshIntervalAtom, selectedNodeIdAtom } from '@/stores/nodeStore'
import { DEFAULT_NODES } from '@/constants/nodes'
import { saveNodeCredentials, deleteNodeCredentials } from '@/api/canton'
import type { NodeConfig, AuthConfig } from '@/types/canton'

const isVercel = import.meta.env.VITE_DEPLOY_ENV === 'vercel'

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-8"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

function AuthConfigForm({ auth, onChange, secretOverride }: {
  auth: AuthConfig;
  onChange: (a: AuthConfig) => void;
  secretOverride?: { value: string; onChange: (v: string) => void; placeholder?: string };
}) {
  const isOAuth2 = auth.mode === 'oauth2'

  const switchMode = (mode: 'shared-secret' | 'oauth2') => {
    if (mode === 'shared-secret') {
      onChange({
        mode: 'shared-secret',
        userId: 'ledger-api-user',
        secret: 'unsafe',
        audience: 'https://canton.network.global',
        issuer: 'unsafe-auth',
      })
    } else {
      onChange({
        mode: 'oauth2',
        tokenUrl: '',
        clientId: '',
        clientSecret: '',
        audience: '',
      })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Key className="h-3 w-3 text-muted-foreground" />
        <label className="text-[10px] text-muted-foreground font-medium">Authentication</label>
      </div>
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant={!isOAuth2 ? 'default' : 'outline'}
          className="h-7 text-[10px]"
          onClick={() => switchMode('shared-secret')}
        >
          Shared Secret
        </Button>
        <Button
          type="button"
          size="sm"
          variant={isOAuth2 ? 'default' : 'outline'}
          className="h-7 text-[10px]"
          onClick={() => switchMode('oauth2')}
        >
          OAuth2
        </Button>
      </div>

      {auth.mode === 'shared-secret' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">User ID</label>
            <Input value={auth.userId} onChange={(e) => onChange({ ...auth, userId: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Secret</label>
            <SecretInput value={auth.secret} onChange={(v) => onChange({ ...auth, secret: v })} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Audience</label>
            <Input value={auth.audience} onChange={(e) => onChange({ ...auth, audience: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Issuer</label>
            <Input value={auth.issuer} onChange={(e) => onChange({ ...auth, issuer: e.target.value })} />
          </div>
        </div>
      )}

      {auth.mode === 'oauth2' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="text-[10px] text-muted-foreground">Token URL</label>
            <Input value={auth.tokenUrl} onChange={(e) => onChange({ ...auth, tokenUrl: e.target.value })} placeholder="https://your-tenant.auth0.com/oauth/token" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Client ID</label>
            <Input value={auth.clientId} onChange={(e) => onChange({ ...auth, clientId: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Client Secret</label>
            {secretOverride ? (
              <SecretInput
                value={secretOverride.value}
                onChange={secretOverride.onChange}
                placeholder={secretOverride.placeholder}
              />
            ) : (
              <SecretInput value={auth.clientSecret} onChange={(v) => onChange({ ...auth, clientSecret: v })} />
            )}
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Audience</label>
            <Input value={auth.audience} onChange={(e) => onChange({ ...auth, audience: e.target.value })} placeholder="https://your-audience" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Validator Audience (optional)</label>
            <Input value={auth.validatorAudience ?? ''} onChange={(e) => onChange({ ...auth, validatorAudience: e.target.value || undefined })} />
          </div>
        </div>
      )}
    </div>
  )
}

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
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [form, setForm] = useState(node)
  // Track the client secret separately — it's only in memory, never in localStorage on Vercel
  const [secretInput, setSecretInput] = useState('')
  const [hasServerCreds, setHasServerCreds] = useState(node.auth.mode === 'oauth2' && !!node.auth._hasServerCredentials)

  const handleSave = async () => {
    setSaveError(null)
    // On Vercel + OAuth2: save credentials to server, strip secret from local storage
    if (isVercel && form.auth.mode === 'oauth2' && secretInput) {
      try {
        setSaving(true)
        await saveNodeCredentials(form.id, {
          tokenUrl: form.auth.tokenUrl,
          clientId: form.auth.clientId,
          clientSecret: secretInput,
          audience: form.auth.audience,
          validatorAudience: form.auth.validatorAudience,
        })
        setHasServerCreds(true)
        // Save node config WITHOUT the secret — only a flag indicating server has it
        const sanitizedForm: NodeConfig = {
          ...form,
          auth: { ...form.auth, clientSecret: '', _hasServerCredentials: true },
        }
        onUpdate(sanitizedForm)
        setSecretInput('')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save credentials'
        setSaveError(msg)
        return
      } finally {
        setSaving(false)
      }
    } else {
      // Local dev or shared-secret: store as-is (credentials only in local config)
      onUpdate(form)
    }
    setEditing(false)
  }

  const handleCancel = () => {
    setForm(node)
    setEditing(false)
  }

  const isLocal = node.jsonApiUrl === 'http://localhost'

  return (
    <Card className={isSelected ? 'border-primary' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: node.color }} />
            <span className="font-medium text-sm">{node.name}</span>
            {isSelected && <Badge variant="default" className="text-[10px]">Active</Badge>}
            <Badge variant={isLocal ? 'secondary' : 'outline'} className="text-[10px]">
              {isLocal ? 'Local' : 'Remote'}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {node.auth.mode === 'oauth2' ? 'OAuth2' : 'Shared Secret'}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => editing ? handleCancel() : setEditing(true)}>
              {editing ? 'Cancel' : 'Edit'}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-3">
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

            <Separator />
            <div className="flex items-center gap-1">
              <Globe className="h-3 w-3 text-muted-foreground" />
              <label className="text-[10px] text-muted-foreground font-medium">Connection</label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="text-[10px] text-muted-foreground">JSON API URL</label>
                <Input value={form.jsonApiUrl} onChange={(e) => setForm({ ...form, jsonApiUrl: e.target.value })} placeholder="http://localhost or http://1.2.3.4" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Port</label>
                <Input type="number" value={form.jsonApiPort} onChange={(e) => setForm({ ...form, jsonApiPort: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="text-[10px] text-muted-foreground">Validator API URL</label>
                <Input value={form.validatorApiUrl} onChange={(e) => setForm({ ...form, validatorApiUrl: e.target.value })} placeholder="http://localhost or http://1.2.3.4" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Port</label>
                <Input type="number" value={form.validatorApiPort} onChange={(e) => setForm({ ...form, validatorApiPort: parseInt(e.target.value) || 0 })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Admin User (optional)</label>
                <Input value={form.adminUser ?? ''} onChange={(e) => setForm({ ...form, adminUser: e.target.value || undefined })} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Global Synchronizer ID (optional)</label>
                <Input value={form.globalSynchronizerId ?? ''} onChange={(e) => setForm({ ...form, globalSynchronizerId: e.target.value || undefined })} />
              </div>
            </div>

            <Separator />
            <AuthConfigForm
              auth={form.auth}
              onChange={(auth) => setForm({ ...form, auth })}
              secretOverride={isVercel && form.auth.mode === 'oauth2' ? {
                value: secretInput,
                onChange: setSecretInput,
                placeholder: hasServerCreds ? '••••••••  (stored on server)' : 'Enter client secret',
              } : undefined}
            />

            {saveError && (
              <p className="text-xs text-destructive">{saveError}</p>
            )}
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">JSON API: </span>
              <span className="font-mono text-[10px]">
                {node.jsonApiUrl === 'http://localhost'
                  ? `localhost:${node.jsonApiPort}`
                  : node.jsonApiPort ? `${node.jsonApiUrl}:${node.jsonApiPort}` : node.jsonApiUrl}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Validator: </span>
              <span className="font-mono text-[10px]">
                {node.validatorApiUrl === 'http://localhost'
                  ? `localhost:${node.validatorApiPort}`
                  : node.validatorApiPort ? `${node.validatorApiUrl}:${node.validatorApiPort}` : node.validatorApiUrl}
              </span>
            </div>
            {node.adminUser && (
              <div>
                <span className="text-muted-foreground">Admin: </span>
                <span className="font-mono">{node.adminUser}</span>
              </div>
            )}
            {node.globalSynchronizerId && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Synchronizer: </span>
                <span className="font-mono text-[10px]">{node.globalSynchronizerId}</span>
              </div>
            )}
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
      auth: {
        mode: 'shared-secret',
        userId: 'ledger-api-user',
        secret: 'unsafe',
        audience: 'https://canton.network.global',
        issuer: 'unsafe-auth',
      },
    }
    setNodes([...nodes, newNode])
  }

  const handleAddRemoteNode = () => {
    const newNode: NodeConfig = {
      id: `remote-${Date.now()}`,
      name: `Remote Node ${nodes.length + 1}`,
      jsonApiUrl: 'http://146.59.110.100',
      jsonApiPort: 7575,
      validatorApiUrl: 'http://146.59.110.100',
      validatorApiPort: 5003,
      ledgerApiPort: 0,
      color: '#ec4899',
      auth: {
        mode: 'oauth2',
        tokenUrl: '',
        clientId: '',
        clientSecret: '',
        audience: '',
      },
    }
    setNodes([...nodes, newNode])
  }

  const handleUpdateNode = (index: number, updated: NodeConfig) => {
    const next = [...nodes]
    next[index] = updated
    setNodes(next)
  }

  const handleDeleteNode = (index: number) => {
    const node = nodes[index]
    // Clean up server-side credentials if stored
    if (isVercel && node.auth.mode === 'oauth2') {
      deleteNodeCredentials(node.id).catch(() => {})
    }
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
          {!isVercel && (
            <Button variant="outline" size="sm" onClick={handleAddNode}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Local Node
            </Button>
          )}
          <Button size="sm" onClick={handleAddRemoteNode}>
            <Globe className="h-3.5 w-3.5 mr-1" /> Remote Node
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
