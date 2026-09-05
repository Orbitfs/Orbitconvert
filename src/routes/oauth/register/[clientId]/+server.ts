import { json } from '@sveltejs/kit';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { normalizeScope, sha256 } from '$lib/server/mcp-oauth';

function bearer(request: Request) {
	const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
	return match?.[1]?.trim() || '';
}

function safeHttpsUrl(value: unknown) {
	if (value === null || value === '') return null;
	try { const url = new URL(String(value)); return url.protocol === 'https:' ? url.toString() : undefined; }
	catch { return undefined; }
}

function validRedirect(value: string, applicationType: string) {
	try {
		const url = new URL(value);
		if (url.hash) return false;
		if (applicationType === 'web') return url.protocol === 'https:';
		if (url.protocol === 'https:') return true;
		if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
		return !['http:', 'https:', 'javascript:', 'data:', 'file:'].includes(url.protocol);
	} catch { return false; }
}

async function registeredClient(request: Request, clientId: string) {
	const token = bearer(request);
	if (!token) return { error: json({ error: 'invalid_token' }, { status: 401 }) };
	const db = getSupabaseAdmin();
	const { data, error } = await db.from('mcp_oauth_clients').select('*')
		.eq('client_id', clientId).eq('registration_access_token_hash', sha256(token)).maybeSingle();
	if (error) throw error;
	if (!data) return { error: json({ error: 'invalid_token' }, { status: 401 }) };
	return { data, db };
}

function publicRecord(row: any) {
	return {
		client_id: row.client_id, client_id_issued_at: row.client_id_issued_at,
		client_name: row.client_name, application_type: row.application_type,
		redirect_uris: row.redirect_uris || [], token_endpoint_auth_method: row.token_endpoint_auth_method,
		grant_types: row.grant_types || [], response_types: row.response_types || [], scope: row.scope,
		client_uri: row.client_uri, logo_uri: row.logo_uri, tos_uri: row.tos_uri,
		policy_uri: row.policy_uri, contacts: row.contacts || [], jwks_uri: row.jwks_uri,
		registration_client_uri: row.registration_client_uri
	};
}

export async function GET({ request, params }) {
	const result = await registeredClient(request, params.clientId);
	if (result.error) return result.error;
	return json(publicRecord(result.data), { headers: { 'cache-control': 'no-store' } });
}

export async function PUT({ request, params }) {
	const result = await registeredClient(request, params.clientId);
	if (result.error) return result.error;
	const body = await request.json().catch(() => ({}));
	if (body.client_id && body.client_id !== params.clientId) return json({ error: 'invalid_client_metadata', error_description:'client_id is immutable' }, { status: 400 });
	if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') return json({ error:'invalid_client_metadata', error_description:'Only public PKCE clients are supported' },{status:400});
	if (body.grant_types && (!Array.isArray(body.grant_types) || body.grant_types.some((v:unknown)=>!['authorization_code','refresh_token'].includes(String(v))) || !body.grant_types.map(String).includes('authorization_code'))) return json({error:'invalid_client_metadata',error_description:'Unsupported grant_types'},{status:400});
	if (body.response_types && (!Array.isArray(body.response_types) || body.response_types.some((v:unknown)=>String(v)!=='code'))) return json({error:'invalid_client_metadata',error_description:'Only response_type code is supported'},{status:400});

	const applicationType = body.application_type === undefined ? String(result.data.application_type || 'web') : String(body.application_type);
	if (!['web','native'].includes(applicationType)) return json({error:'invalid_client_metadata',error_description:'application_type must be web or native'},{status:400});
	const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), application_type: applicationType };
	if (body.client_name !== undefined) patch.client_name = String(body.client_name || 'MCP Client').slice(0,120);
	for (const key of ['client_uri','logo_uri','tos_uri','policy_uri','jwks_uri']) {
		if (body[key] === undefined) continue;
		const value=safeHttpsUrl(body[key]);
		if (value === undefined) return json({error:'invalid_client_metadata',error_description:`${key} must be HTTPS or null`},{status:400});
		patch[key]=value;
	}
	if (body.scope !== undefined) patch.scope = normalizeScope(String(body.scope || ''));
	if (body.redirect_uris !== undefined) {
		if (!Array.isArray(body.redirect_uris)) return json({error:'invalid_redirect_uri',error_description:'redirect_uris must be an array'},{status:400});
		const redirects: string[]=[...new Set<string>(body.redirect_uris.map((v:unknown)=>String(v)))];
		if (!redirects.length || redirects.some((uri)=>!validRedirect(uri,applicationType))) return json({error:'invalid_redirect_uri',error_description:'A valid redirect_uris list is required'},{status:400});
		patch.redirect_uris=redirects;
	}
	if (body.contacts !== undefined) {
		if (!Array.isArray(body.contacts)) return json({error:'invalid_client_metadata',error_description:'contacts must be an array'},{status:400});
		patch.contacts=body.contacts.map(String).slice(0,20);
	}
	const { data, error } = await result.db.from('mcp_oauth_clients').update(patch).eq('client_id', params.clientId).select('*').single();
	if (error) throw error;
	if (patch.client_name || patch.redirect_uris) {
		await result.db.from('mcp_clients').update({
			...(patch.client_name ? { client_name: patch.client_name } : {}),
			...(patch.redirect_uris ? { redirect_uris: patch.redirect_uris } : {}),
			last_seen_at: new Date().toISOString()
		}).eq('id', params.clientId);
	}
	return json(publicRecord(data), { headers: { 'cache-control': 'no-store' } });
}

export async function DELETE({ request, params }) {
	const result = await registeredClient(request, params.clientId);
	if (result.error) return result.error;
	const revokedAt = new Date().toISOString();
	await result.db.from('mcp_oauth_tokens').update({ revoked_at: revokedAt }).eq('client_id', params.clientId).is('revoked_at', null);
	await result.db.from('mcp_clients').update({ status: 'revoked', last_seen_at: revokedAt }).eq('id', params.clientId);
	const { error } = await result.db.from('mcp_oauth_clients').delete().eq('client_id', params.clientId);
	if (error) throw error;
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
