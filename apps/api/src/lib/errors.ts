// Throw an AppError anywhere in a route or service; the error handler
// turns it into a consistent JSON response: { error: { code, message, details? } }.
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
