export interface NodeCredentials {
  tokenUrl: string
  clientId: string
  clientSecret: string
  audience: string
  validatorAudience?: string
}

export interface PublicCredentialFields {
  exists: boolean
  tokenUrl?: string
  clientId?: string
  audience?: string
  validatorAudience?: string
}

export declare function mergeNodeCredentials(
  existing: NodeCredentials | null | undefined,
  incoming: Partial<NodeCredentials> | null | undefined,
): NodeCredentials | null

export declare function publicCredentialFields(
  creds: NodeCredentials | null | undefined,
): PublicCredentialFields
