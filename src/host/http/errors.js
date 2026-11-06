/**
 * Route error carrying the HTTP status to answer with.
 *
 * The application layers never import this module; the composition root injects
 * the class into the use-case factories so they can signal 4xx/5xx outcomes
 * without depending on the transport layer.
 *
 * @module host/http/errors
 */

export class RouteError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
    this.name = 'RouteError'
  }
}
