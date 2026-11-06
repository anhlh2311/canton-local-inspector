export declare function applyLighthouseAuth<T extends Record<string, unknown>>(
  headers: T,
  targetOrigin: string,
  apiKey?: string,
): T
