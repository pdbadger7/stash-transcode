/**
 * Simple token-based authentication
 */
export class AuthValidator {
  private token?: string;

  constructor(sharedToken?: string) {
    this.token = sharedToken;
  }

  /**
   * Check if request has valid token
   * For MVP, support query parameter only
   */
  validateQueryToken(queryToken?: string): boolean {
    if (!this.token) {
      // No token configured, allow all
      return true;
    }

    if (!queryToken) {
      return false;
    }

    return queryToken === this.token;
  }

  /**
   * Check if request has valid Authorization header token
   */
  validateHeaderToken(authHeader?: string): boolean {
    if (!this.token) {
      return true;
    }

    if (!authHeader) {
      return false;
    }

    // Support "Bearer <token>" format
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return false;
    }

    return parts[1] === this.token;
  }
}
