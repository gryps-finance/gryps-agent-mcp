import { ZodError } from 'zod'
import { RESPONSE_SCHEMA_VERSION } from './constants.js'

export type PublicErrorCode =
  | 'invalid_configuration'
  | 'not_found'
  | 'ambiguous_symbol'
  | 'upstream_unavailable'
  | 'upstream_schema_mismatch'
  | 'internal_error'

export class PublicMcpError extends Error {
  readonly retryable: boolean

  constructor(
    readonly code: PublicErrorCode,
    message: string,
    options?: { retryable?: boolean },
  ) {
    super(message)
    this.name = 'PublicMcpError'
    this.retryable = options?.retryable ?? false
  }
}

export interface ErrorEnvelope {
  schemaVersion: string
  status: 'error'
  error: {
    code: PublicErrorCode
    message: string
  }
  meta: {
    fetchedAt: string
    readOnly: true
  }
}

export function toPublicError(error: unknown): PublicMcpError {
  if (error instanceof PublicMcpError) return error
  if (error instanceof ZodError) {
    return new PublicMcpError(
      'upstream_schema_mismatch',
      'The live Gryps endpoint returned an unexpected response shape.',
    )
  }
  return new PublicMcpError('internal_error', 'The read request could not be completed.')
}

export function errorEnvelope(error: unknown): ErrorEnvelope {
  const safe = toPublicError(error)
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    status: 'error',
    error: { code: safe.code, message: safe.message },
    meta: { fetchedAt: new Date().toISOString(), readOnly: true },
  }
}
