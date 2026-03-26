export interface NodeConfig {
  id: string
  name: string
  jsonApiUrl: string
  jsonApiPort: number
  validatorApiUrl: string
  validatorApiPort: number
  ledgerApiPort: number
  color: string
}

export interface ConnectedSynchronizer {
  synchronizerId: string
  participantId?: string
}

export interface ConnectedSynchronizersResponse {
  connectedSynchronizers: ConnectedSynchronizer[]
}

export interface LedgerEndResponse {
  offset: string
}

export interface VersionResponse {
  version: string
  features: Record<string, string>
}

export interface User {
  id: string
  primaryParty: string
  isDeactivated: boolean
  metadata?: {
    resourceVersion: string
    annotations: Record<string, string>
  }
  identityProviderId: string
}

export interface UserRight {
  kind: Record<string, { value: { party?: string } }>
}

export interface UsersResponse {
  users: { user: User; rights: UserRight[] }[]
  nextPageToken?: string
}

export interface UserResponse {
  user: User
  rights: UserRight[]
}

export interface PartyDetails {
  party: string
  displayName?: string
  isLocal: boolean
  localMetadata?: {
    accessRights: string[]
  }
}

export interface PartyResponse {
  partyDetails: PartyDetails[]
}

export interface ParticipantIdResponse {
  participantId: string
}

export interface PackagesResponse {
  packageIds: string[]
}

export interface TemplateFilter {
  templateId: string
  includeCreatedEventBlob?: boolean
}

export interface InterfaceFilter {
  interfaceId: string
  includeCreatedEventBlob?: boolean
  includeInterfaceView?: boolean
}

export interface ActiveContractsFilter {
  filtersByParty: Record<string, {
    cumulative: {
      identifierFilter: {
        TemplateFilter?: { value: TemplateFilter }
        InterfaceFilter?: { value: InterfaceFilter }
        WildcardFilter?: { value: { includeCreatedEventBlob: boolean } }
      }
    }[]
  }>
}

export interface ActiveContractsRequest {
  filter: ActiveContractsFilter
  verbose: boolean
  activeAtOffset?: string
}

export interface CreatedEvent {
  contractId: string
  templateId: string
  createArgument: Record<string, unknown>
  createdEventBlob?: string
  signatories: string[]
  observers: string[]
  createdAt?: string
  packageName?: string
}

export interface ActiveContract {
  contractEntry: {
    JsActiveContract: {
      createdEvent: CreatedEvent
      synchronizerId: string
      reassignmentCounter: number
    }
  }
}

export type ActiveContractsResponse = ActiveContract[]

export interface DsoPartyResponse {
  dso_party_id: string
}

export interface NodeHealth {
  nodeId: string
  name: string
  status: 'online' | 'offline' | 'checking'
  version?: string
  latencyMs?: number
}
