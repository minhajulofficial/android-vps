export interface AppErrorInput {
  code: ErrorCode;
  message: string;
  httpStatus?: number;
  details?: unknown;
}

/** Canonical machine-readable error codes used across the whole API. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INSTANCE_NOT_FOUND'
  | 'INSTANCE_ALREADY_RUNNING'
  | 'INSTANCE_NOT_RUNNING'
  | 'CONFLICT'
  | 'INSUFFICIENT_RESOURCES'
  | 'PORT_IN_USE'
  | 'RUNTIME_UNAVAILABLE'
  | 'DRIVER_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details: unknown;

  constructor(input: AppErrorInput) {
    super(input.message);
    this.name = 'AppError';
    this.code = input.code;
    this.httpStatus = input.httpStatus ?? statusFor(input.code);
    this.details = input.details;
  }
}

function statusFor(code: ErrorCode): number {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 400;
    case 'UNAUTHORIZED':
    case 'AUTH_FAILED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'INSTANCE_NOT_FOUND':
      return 404;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
    case 'INSTANCE_ALREADY_RUNNING':
    case 'INSTANCE_NOT_RUNNING':
      return 409;
    case 'INSUFFICIENT_RESOURCES':
    case 'PORT_IN_USE':
      return 409;
    case 'RUNTIME_UNAVAILABLE':
      return 503;
    case 'RATE_LIMITED':
      return 429;
    default:
      return 500;
  }
}