import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '$lib/server/supabase';

export const MCP_RESOURCE = 'https://orbitconvert-mcp-addon.vercel.app/mcp';
export const OAUTH_ISSUER = 'https://orbitconvert.vercel.app';
export const OAUTH_SCOPES = ['orbitfs:read', 'orbitfs:write', 'offline_access'] as const;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const pkce = (value: string) => createHash('sha256').update(value).digest('base64url');
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function normalizeScope(scope = '') {
	const requested = scope.split(/\s+/).filter(Boolean);
	const allowed = requested.filter((item) => (OAUTH_SCOPES as readonly string[]).includes(item));
	return [...new Set(allowed.length ? allowed : ['orbitfs:read'])].join(' ');
}

export function assertResource(resource: string | null | undefined) {
	if (resource !== MCP_RESOURCE) throw Object.assign(new Error('Invalid OAuth resource'), { status: 400 });
	return MCP_RESOURCE;
}
export async function getOAuthClient(clientId: string) {
	const db = getSupabaseAdmin();
	const { data, error } = await db.from('mcp_oauth_clients').select('*').eq('client_id', clientId).maybeSingle();
	if (error) throw error;
	if (!data) throw Object.assign(new Error('Unknown OAuth client'), { status: 400 });
	return data;
}

export async function validateAuthorizationRequest(input: {
	clientId: string; redirectUri: string; responseType: string; codeChallenge: string;
	codeChallengeMethod: string; resource: string; scope?: string;
}) {
	if (input.responseType !== 'code') throw Object.assign(new Error('Only response_type=code is supported'), { status: 400 });
	if (!input.codeChallenge || input.codeChallengeMethod !== 'S256') throw Object.assign(new Error('PKCE S256 is required'), { status: 400 });
	const resource = assertResource(input.resource || MCP_RESOURCE);
	const client = await getOAuthClient(input.clientId);
	const redirects = Array.isArray(client.redirect_uris) ? client.redirect_uris.map(String) : [];
	if (!redirects.includes(input.redirectUri)) throw Object.assign(new Error('Redirect URI is not registered'), { status: 400 });
	const scope = normalizeScope(input.scope);
	const registeredScopes = new Set(String(client.scope || 'orbitfs:read').split(/\s+/).filter(Boolean));
	const requestedScopes = scope.split(/\s+/).filter(Boolean);
	if (requestedScopes.some((item) => !registeredScopes.has(item))) {
		throw Object.assign(new Error('Requested OAuth scope is not registered for this client'), { status: 400, code: 'OAUTH_INVALID_SCOPE' });
	}
	return { client, scope, resource };
}

export async function issueAuthorizationCode(input: {
	clientId: string; userId: string; redirectUri: string; scope: string;
	resource: string; codeChallenge: string;
}) {
	const code = randomToken(32);
	const db = getSupabaseAdmin();
	const { error } = await db.from('mcp_oauth_codes').insert({
		code_hash: sha256(code), client_id: input.clientId, user_id: input.userId,
		redirect_uri: input.redirectUri, scope: input.scope, resource: input.resource,
		code_challenge: input.codeChallenge, code_challenge_method: 'S256',
		expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString()
	});
	if (error) throw error;
	return code;
}

async function resolveClientWorkspaceIds(db: any, userId: string) {
	const [userResult, workspaceResult, membershipResult] = await Promise.all([
		db.from('orbitfs_users').select('role').eq('id', userId).maybeSingle(),
		db.from('orbitfs_workspaces').select('id,owner_id,created_by,status,mcp_system_enabled').neq('status', 'archived'),
		db.from('orbitfs_workspace_members').select('workspace_id,mcp_enabled').eq('user_id', userId)
	]);
	if (userResult.error) throw userResult.error;
	if (workspaceResult.error) throw workspaceResult.error;
	if (membershipResult.error) throw membershipResult.error;
	const systemRole = String(userResult.data?.role || 'user').toLowerCase();
	const memberships = new Map((membershipResult.data || []).map((row: any) => [String(row.workspace_id), row]));
	return (workspaceResult.data || []).filter((workspace: any) => {
		if (workspace.mcp_system_enabled === false) return false;
		const membership: any = memberships.get(String(workspace.id));
		if (membership?.mcp_enabled === false) return false;
		if (membership?.mcp_enabled === true) return true;
		if (String(workspace.owner_id || workspace.created_by || '') === userId) return true;
		return systemRole === 'owner' || systemRole === 'admin';
	}).map((workspace: any) => String(workspace.id));
}

async function storeTokens(clientId: string, userId: string, scope: string, resource: string) {
	const accessToken = randomToken(32), refreshToken = randomToken(40), db = getSupabaseAdmin();
	const expiresAt = new Date(Date.now() + ACCESS_TTL_MS).toISOString();
	const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();
	const { error } = await db.from('mcp_oauth_tokens').insert({
		access_token_hash: sha256(accessToken), refresh_token_hash: sha256(refreshToken), client_id: clientId,
		user_id: userId, scope, resource, expires_at: expiresAt, refresh_expires_at: refreshExpiresAt
	});
	if (error) throw error;
	const workspaceIds = await resolveClientWorkspaceIds(db, userId);
	const clientUpdate = await db.from('mcp_clients').update({ user_id:userId, status:'active', workspace_ids:workspaceIds, last_seen_at:new Date().toISOString() }).eq('id',clientId);
	if (clientUpdate.error) throw clientUpdate.error;
	return { access_token: accessToken, token_type: 'Bearer', expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refreshToken, scope };
}

export async function exchangeAuthorizationCode(input: {
	code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string;
}) {
	assertResource(input.resource);
	const db = getSupabaseAdmin();
	const codeHash = sha256(input.code);
	const { data: row, error } = await db.from('mcp_oauth_codes').select('*').eq('code_hash', codeHash).maybeSingle();
	if (error) throw error;
	if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) throw Object.assign(new Error('Invalid or expired authorization code'), { status: 400 });
	if (row.client_id !== input.clientId || row.redirect_uri !== input.redirectUri || row.resource !== input.resource) throw Object.assign(new Error('Authorization code binding mismatch'), { status: 400 });
	const expected = Buffer.from(String(row.code_challenge));
	const actual = Buffer.from(pkce(input.codeVerifier));
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw Object.assign(new Error('PKCE verification failed'), { status: 400 });
	const consumedAt = new Date().toISOString();
	const { data: consumed, error: consumeError } = await db.from('mcp_oauth_codes')
		.update({ consumed_at: consumedAt })
		.eq('code_hash', codeHash)
		.is('consumed_at', null)
		.select('code_hash')
		.maybeSingle();
	if (consumeError) throw consumeError;
	if (!consumed) throw Object.assign(new Error('Authorization code has already been used'), { status: 400 });
	return storeTokens(row.client_id, row.user_id, row.scope, row.resource);
}

export async function exchangeRefreshToken(input: { refreshToken: string; clientId: string; resource: string }) {
	assertResource(input.resource);
	const db = getSupabaseAdmin();
	const { data: row, error } = await db.from('mcp_oauth_tokens').select('*').eq('refresh_token_hash', sha256(input.refreshToken)).maybeSingle();
	if (error) throw error;
	if (!row || row.revoked_at || row.client_id !== input.clientId || row.resource !== input.resource || !row.refresh_expires_at || new Date(row.refresh_expires_at).getTime() <= Date.now()) {
		throw Object.assign(new Error('Invalid or expired refresh token'), { status: 400 });
	}
	const { data: client, error: clientError } = await db.from('mcp_clients').select('id,status').eq('id',row.client_id).maybeSingle();
	if (clientError) throw clientError;
	if (!client || client.status !== 'active') throw Object.assign(new Error('MCP client is disabled or disconnected'), { status: 400 });
	await db.from('mcp_oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('access_token_hash', row.access_token_hash);
	return storeTokens(row.client_id, row.user_id, row.scope, row.resource);
}

export async function authenticateMcpAccessToken(request: Request) {
	const header = request.headers.get('authorization') || '';
	const match = /^Bearer\s+(.+)$/i.exec(header);
	if (!match) throw Object.assign(new Error('MCP bearer token required'), { status: 401, code: 'MCP_AUTH_REQUIRED' });
	const tokenHash = sha256(match[1]);
	const db = getSupabaseAdmin();
	const { data: token, error } = await db.from('mcp_oauth_tokens').select('*').eq('access_token_hash', tokenHash).maybeSingle();
	if (error) throw error;
	if (!token || token.revoked_at || new Date(token.expires_at).getTime() <= Date.now()) {
		throw Object.assign(new Error('Invalid or expired MCP access token'), { status: 401, code: 'MCP_TOKEN_INVALID' });
	}
	if (token.resource !== MCP_RESOURCE) throw Object.assign(new Error('MCP token resource mismatch'), { status: 401, code: 'MCP_RESOURCE_MISMATCH' });
	const { data: user, error: userError } = await db.from('orbitfs_users')
		.select('id,username,display_name,email,role,status,avatar_url,permissions,must_change_pin,ban_reason')
		.eq('id', token.user_id).maybeSingle();
	if (userError) throw userError;
	if (!user || user.status !== 'active') throw Object.assign(new Error('MCP user is unavailable'), { status: 403, code: 'MCP_USER_INACTIVE' });
	void db.from('mcp_oauth_tokens').update({ last_used_at: new Date().toISOString() }).eq('access_token_hash', tokenHash);
	return { user, token, scopes: new Set(String(token.scope || '').split(/\s+/).filter(Boolean)) };
}
