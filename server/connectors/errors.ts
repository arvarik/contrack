/**
 * Connector errors. An authentication error moves a connector to
 * `needs_reauth`; network and configuration errors do not.
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
 * Credentials failed, were refused or expired. The connector moves to
 * `needs_reauth`.
 */
export class ConnectorAuthError extends ConnectorError {
  constructor(
    message = "Connector authentication failed or credentials expired",
    details?: Record<string, unknown>,
  ) {
    super(message, 401, { code: "CONNECTOR_AUTH_ERROR", ...details });
  }
}

/** The connector configuration is malformed, invalid or unreachable. */
export class ConnectorConfigError extends ConnectorError {
  constructor(
    message = "Invalid connector configuration",
    details?: Record<string, unknown>,
  ) {
    super(message, 400, { code: "CONNECTOR_CONFIG_ERROR", ...details });
  }
}
