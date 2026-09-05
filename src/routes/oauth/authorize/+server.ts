import { redirect } from '@sveltejs/kit';
import { authenticateOrbitCredentials } from '$lib/server/auth';
import { issueAuthorizationCode, OAUTH_ISSUER, validateAuthorizationRequest } from '$lib/server/mcp-oauth';

const esc = (value:string) => value.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));

function paramsFrom(url: URL) {
	return {
		clientId:String(url.searchParams.get('client_id')||''), redirectUri:String(url.searchParams.get('redirect_uri')||''),
		responseType:String(url.searchParams.get('response_type')||''), codeChallenge:String(url.searchParams.get('code_challenge')||''),
		codeChallengeMethod:String(url.searchParams.get('code_challenge_method')||''), resource:String(url.searchParams.get('resource')||''),
		scope:String(url.searchParams.get('scope')||''), state:String(url.searchParams.get('state')||'')
	};
}

function appendRedirect(uri:string, values:Record<string,string>) {
	const out = new URL(uri);
	for (const [key,value] of Object.entries(values)) if (value) out.searchParams.set(key,value);
	return out.toString();
}

function renderLogin(input:ReturnType<typeof paramsFrom>, scope:string, error='') {
	const hidden = Object.entries({ client_id:input.clientId,redirect_uri:input.redirectUri,response_type:input.responseType,
		code_challenge:input.codeChallenge,code_challenge_method:input.codeChallengeMethod,resource:input.resource,
		scope,state:input.state }).map(([k,v])=>`<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`).join('');
	const scopes=scope.split(' ').filter(Boolean).map((value)=>`<li>${esc(value==='orbitfs:write'?'Read and update permitted OrbitFS content':value==='offline_access'?'Stay connected using refresh access':'Read permitted OrbitFS content')}</li>`).join('');
	const message=error?`<div class="error">${esc(error)}</div>`:'';
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect OrbitFS</title><style>body{font-family:system-ui;background:#0b0d10;color:#f5f7fa;margin:0;display:grid;place-items:center;min-height:100vh}.card{width:min(460px,calc(100% - 32px));background:#15181d;border:1px solid #2b3038;border-radius:16px;padding:24px;box-sizing:border-box}p,li{color:#bac1cb;line-height:1.5}input,button{box-sizing:border-box;width:100%;margin-top:12px;padding:12px;border-radius:10px;border:1px solid #343b46;background:#0e1115;color:#fff;font-size:15px}button{background:#fff;color:#111;border:0;font-weight:700;cursor:pointer}.error{margin:12px 0 0;padding:10px 12px;border-radius:9px;background:#3a161b;color:#ffb4bd}.hint{font-size:13px;color:#8d96a3}</style></head><body><main class="card"><h1>Connect ChatGPT to OrbitFS</h1><p>Sign in with the same OrbitFS account you use for the Panel. Your MCP access follows that account's workspace permissions.</p>${message}<form method="post">${hidden}<input name="identity" placeholder="Username or email" autocomplete="username" required autofocus><input type="password" name="credential" placeholder="Password or PIN" autocomplete="current-password" required><button type="submit">Connect OrbitFS</button></form><h3>Connection access</h3><ul>${scopes}</ul><p class="hint">Only workspaces and content your OrbitFS account can access will be exposed to MCP.</p></main></body></html>`;
}

export async function GET({ url }) {
	const input=paramsFrom(url);
	try {
		const validated=await validateAuthorizationRequest(input);
		return new Response(renderLogin(input,validated.scope),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
	} catch (e) {
		return new Response(e instanceof Error ? e.message : 'Invalid authorization request',{status:400});
	}
}

export async function POST({ request }) {
	const form=await request.formData();
	const input={clientId:String(form.get('client_id')||''),redirectUri:String(form.get('redirect_uri')||''),
		responseType:String(form.get('response_type')||''),codeChallenge:String(form.get('code_challenge')||''),
		codeChallengeMethod:String(form.get('code_challenge_method')||''),resource:String(form.get('resource')||''),
		scope:String(form.get('scope')||''),state:String(form.get('state')||'')};
	let validated;
	try { validated=await validateAuthorizationRequest(input); }
	catch (e) { return new Response(e instanceof Error ? e.message : 'Invalid authorization request',{status:400}); }
	const identity=String(form.get('identity')||'').trim();
	const credential=String(form.get('credential')||'');
	let user;
	try { user=await authenticateOrbitCredentials(identity,credential); }
	catch { return new Response(renderLogin(input,validated.scope,'OrbitFS login is temporarily unavailable.'),{status:500,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}}); }
	if(!user) return new Response(renderLogin(input,validated.scope,'Invalid OrbitFS username/email or password/PIN.'),{status:401,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
	if(user.status==='banned') return new Response(renderLogin(input,validated.scope,user.ban_reason?`Account banned: ${user.ban_reason}`:'OrbitFS account is banned.'),{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
	if(user.status!=='active') return new Response(renderLogin(input,validated.scope,'OrbitFS account is inactive.'),{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
	if(user.must_change_pin) return new Response(renderLogin(input,validated.scope,'Change your temporary password/PIN in the OrbitFS Panel before connecting ChatGPT.'),{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
	const code=await issueAuthorizationCode({clientId:input.clientId,userId:user.id,redirectUri:input.redirectUri,
		scope:validated.scope,resource:validated.resource,codeChallenge:input.codeChallenge});
	throw redirect(303,appendRedirect(input.redirectUri,{code,state:input.state,iss:OAUTH_ISSUER}));
}
