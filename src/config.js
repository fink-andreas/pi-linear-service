/**
 * Environment configuration and validation
 */

/**
 * Required environment variables
 */
const REQUIRED_VARS = ['LINEAR_API_KEY', 'ASSIGNEE_ID'];

/**
 * Validate environment variables
 * @throws {Error} If required environment variables are missing
 * @returns {Object} Configuration object with all settings
 */
export function validateEnv() {
  const missing = [];

  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Please create a .env file or set these variables before starting the service.'
    );
  }

  // Return config object (will be expanded in future issues)
  return {
    linearApiKey: process.env.LINEAR_API_KEY,
    assigneeId: process.env.ASSIGNEE_ID,
  };
}
