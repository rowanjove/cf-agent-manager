export type ErrorCode =
  | "AUTH_INVALID"
  | "AUTH_FORBIDDEN"
  | "CF_RATE_LIMITED"
  | "CF_API_ERROR"
  | "CF_NETWORK_ERROR"
  | "ACCOUNT_NOT_CONFIGURED"
  | "RESOURCE_NOT_FOUND"
  | "POLICY_DENIED"
  | "CONFIRMATION_REQUIRED"
  | "INPUT_INVALID"
  | "PATH_NOT_ALLOWED"
  | "PROJECT_NOT_FOUND"
  | "INVALID_PROJECT"
  | "UNSUPPORTED_FRAMEWORK"
  | "OUTPUT_DIRECTORY_NOT_FOUND"
  | "DEPENDENCY_INSTALL_FAILED"
  | "BUILD_FAILED"
  | "BUNDLED_NODE_MISSING"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly recoverable = true,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function toPublicError(error: unknown): { code: ErrorCode; message: string; recoverable: boolean } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, recoverable: error.recoverable };
  }
  return { code: "INTERNAL_ERROR", message: "Unexpected internal error", recoverable: false };
}
