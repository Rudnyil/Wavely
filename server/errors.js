/** An error that is safe to show to API clients. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (code, message) => new ApiError(400, code, message);
export const unauthorized = (message = 'Sign in to continue') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do this') => new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);
export const conflict = (code, message) => new ApiError(409, code, message);
