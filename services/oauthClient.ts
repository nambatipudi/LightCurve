/**
 * OAuth Client Service - Handles OAuth 2.0 client_credentials flow
 * Acquires and manages access tokens for authentication
 */

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  audience: string;
  scopes?: string[];
}

export class OAuthClient {
  private tokenCache: {
    token: string;
    expiresAt: number;
  } | null = null;

  constructor(private config: OAuthClientConfig) {}

  /**
   * Get a valid access token, using cached token if not expired
   */
  async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (
      this.tokenCache &&
      this.tokenCache.expiresAt > Date.now() + 60000
    ) {
      return this.tokenCache.token;
    }

    // Request new token
    const token = await this.requestToken();
    return token;
  }

  /**
   * Request a new access token from the OAuth provider
   */
  private async requestToken(): Promise<string> {
    const issuerUrl = this.config.issuerUrl.replace(/\/$/, ''); // Remove trailing slash

    // Build a list of token endpoints to try. Many providers use different token paths
    // (e.g., /oauth/token, /cached/oauth/token, /protocol/openid-connect/token).
    const tokenEndpoints: string[] = [];

    // If the issuer already looks like a token endpoint, try it first.
    if (/\/token(\?|$)/.test(issuerUrl)) {
      tokenEndpoints.push(issuerUrl);
    }

    // Common defaults for OAuth/OpenID providers
    tokenEndpoints.push(
      `${issuerUrl}/oauth/token`,
      `${issuerUrl}/cached/oauth/token`,
      `${issuerUrl}/protocol/openid-connect/token`,
    );

    // Deduplicate while preserving order
    const uniqueTokenEndpoints = Array.from(new Set(tokenEndpoints));

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      audience: this.config.audience,
    });

    // Add scopes if provided
    if (this.config.scopes && this.config.scopes.length > 0) {
      body.append('scope', this.config.scopes.join(' '));
    }

    const attemptErrors: string[] = [];

    console.log('[OAuthClient] Requesting token', {
      issuerUrl,
      audience: this.config.audience,
      scopes: this.config.scopes,
      endpointsTried: uniqueTokenEndpoints,
    });

    for (const tokenUrl of uniqueTokenEndpoints) {
      try {
        console.log('[OAuthClient] Trying token endpoint', tokenUrl);
        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          const detailedMessage = `${tokenUrl} -> HTTP ${response.status} ${response.statusText} - ${errorText}`;

          // If the endpoint is missing, try the next candidate; otherwise record and try next
          if (response.status === 404) {
            attemptErrors.push(detailedMessage);
            continue;
          }

          throw new Error(detailedMessage);
        }

        const data = (await response.json()) as OAuthTokenResponse;

        // Decode JWT to inspect claims (for debugging)
        let tokenClaims: any = null;
        try {
          const parts = data.access_token.split('.');
          if (parts.length === 3) {
            tokenClaims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
          }
        } catch (e) {
          // Ignore decode errors
        }

        console.log('[OAuthClient] Token acquired', {
          tokenUrl,
          expiresIn: data.expires_in,
          scope: data.scope,
          tokenType: data.token_type,
          claims: tokenClaims,
        });

        // Cache the token with expiration time
        this.tokenCache = {
          token: data.access_token,
          expiresAt: Date.now() + (data.expires_in * 1000) - 60000, // 60s buffer
        };

        return data.access_token;
      } catch (error) {
        attemptErrors.push(`${tokenUrl} -> ${error instanceof Error ? error.message : String(error)}`);
        // Try next endpoint if available
      }
    }

    throw new Error(`Failed to acquire OAuth token: ${attemptErrors.join('; ')}`);
  }

  /**
   * Clear cached token (useful for manual refresh)
   */
  clearCache(): void {
    this.tokenCache = null;
  }
}
