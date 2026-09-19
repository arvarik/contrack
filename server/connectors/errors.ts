/**
 * server/connectors/errors.ts — Connector errors hierarchy.
 *
 * Distinguishes authentication errors (which transition connector to `needs_reauth`)
 * from transient network errors and invalid configurations.
 *
 * @module server/connectors/errors
 */

import { AppError } from "../utils/AppError.ts";

export class ConnectorError extends AppError {
  constructor(
    message: string,
    statusCode = 500,
    details?: Record<string, unknown>,
  ) {
    super(message, statusCode, { code: "CONNECTOR_ERROR", ...details });
  }
}

/**
 * Thrown when credentials fail, are rejected by the remote service, or expired.
 * Causes the connector to transition into `needs_reauth` status.
 */
export class ConnectorAuthError extends ConnectorError {
  constructor(
    message = "Connector authentication failed or credentials expired",
    details?: Record<string, unknown>,
  ) {
    super(message, 401, { code: "CONNECTOR_AUTH_ERROR", ...details });
  }
}

/**
 * Thrown when connector configuration is malformed, invalid, or inaccessible.
 */
export class ConnectorConfigError extends ConnectorError {
  constructor(
    message = "Invalid connector configuration",
    details?: Record<string, unknown>,
  ) {
    super(message, 400, { code: "CONNECTOR_CONFIG_ERROR", ...details });
  }
}
