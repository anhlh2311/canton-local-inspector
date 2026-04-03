import { useAtom, useAtomValue } from 'jotai'
import { useQueryClient } from '@tanstack/react-query'
import { nodesAtom, selectedNodeIdAtom, nodeHealthMapAtom } from '@/stores/nodeStore'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusDot } from '@/components/common/StatusDot'

export function NodeSelector() {
  const nodes = useAtomValue(nodesAtom)
  const [selectedNodeId, setSelectedNodeId] = useAtom(selectedNodeIdAtom)
  const healthMap = useAtomValue(nodeHealthMapAtom)
  const queryClient = useQueryClient()

  const handleNodeChange = (nodeId: string) => {
    if (nodeId === selectedNodeId) return
    setSelectedNodeId(nodeId)
    // Invalidate all queries except health checks to force fresh data for new node
    queryClient.invalidateQueries()
  }

  return (
    <Select value={selectedNodeId} onValueChange={handleNodeChange}>
      <SelectTrigger className="w-[140px] sm:w-[220px]">
        <SelectValue placeholder="Select node" />
      </SelectTrigger>
      <SelectContent>
        {nodes.map((node) => {
          const health = healthMap[node.id]
          return (
            <SelectItem key={node.id} value={node.id}>
              <div className="flex items-center gap-2">
                <StatusDot status={health?.status ?? 'checking'} />
                <span
                  className="font-medium"
                  style={{ color: node.color }}
                >
                  {node.name}
                </span>
                <span className="text-muted-foreground text-xs">:{node.jsonApiPort}</span>
              </div>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
