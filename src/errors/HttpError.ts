export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFound(message = "not_found"): HttpError {
  return new HttpError(404, message);
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function unauthorized(message = "unauthorized"): HttpError {
  return new HttpError(401, message);
}

export function forbidden(message: string): HttpError {
  return new HttpError(403, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}

export function tooManyRequests(message = "too_many_requests"): HttpError {
  return new HttpError(429, message);
}

export function internalError(message = "internal_error"): HttpError {
  return new HttpError(500, message);
}

export function notImplemented(message = "not_implemented"): HttpError {
  return new HttpError(501, message);
}
