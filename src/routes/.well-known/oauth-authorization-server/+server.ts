import { json } from '@sveltejs/kit';
import { OAUTH_ISSUER, OAUTH_SCOPES } from '$lib/server/mcp-oauth';

export function GET() {
	return json({
		issuer: OAUTH_ISSUER,
		authorization_endpoint: `${OAUTH_ISSUER}/oauth/authorize`,
		token_endpoint: `${OAUTH_ISSUER}/oauth/token`,
		registration_endpoint: `${OAUTH_ISSUER}/oauth/register`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		token_endpoint_auth_methods_supported: ['none'],
		code_challenge_methods_supported: ['S256'],
		scopes_supported: [...OAUTH_SCOPES],
		resource_parameter_supported: true,
		authorization_response_iss_parameter_supported: true
	});
}
