import { ErrorCode } from '../types/index.js';
import type { HiraiaError } from '../types/index.js';

/**
 * Create a standardized error object.
 */
export function createError(code: ErrorCode, message: string, details?: unknown): HiraiaError {
  return {
    code,
    message,
    details,
    timestamp: new Date(),
  };
}

/**
 * Type guard to check if an error is a HiraiaError.
 */
export function isHiraiaError(error: unknown): error is HiraiaError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'timestamp' in error
  );
}

/**
 * Wrap an unknown error into a HiraiaError.
 */
export function wrapError(error: unknown, fallbackCode: ErrorCode = ErrorCode.UNKNOWN): HiraiaError {
  if (isHiraiaError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return createError(fallbackCode, error.message, error);
  }

  return createError(fallbackCode, String(error));
}
