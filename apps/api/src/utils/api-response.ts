import { AppError } from './errors.js';

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  error: null;
}

export interface ErrorEnvelope {
  success: false;
  data: null;
  error: { code: string; message: string; details?: unknown };
}

export function ok<T>(data: T): SuccessEnvelope<T> {
  return { success: true, data, error: null };
}

export function fail(error: AppError): ErrorEnvelope {
  return {
    success: false,
    data: null,
    error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) }
  };
}