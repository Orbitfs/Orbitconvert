import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { ensureInstallationIdentity } from '$lib/server/license';

export const ENGINE_HOST_URL = 'https://orbitfsengine.vercel.app';
export const ENGINE_HOST_PREVIEW_URL = 'https://orbitfsengine-git-engine-hub-v2-lucaskerim123s-projects.vercel.app';
export const PANEL_URL = 'https://orbitfs.vercel.app';

export type EngineMode = 'running' | 'standby' | 'stopped';

type EngineState = {
	addonId: string;
	name: string;
	mode: EngineMode;
	generation: number;
	lastRequestAt: string | null;
	lastControlAt: string | null;
	lastControlBy: string | null;
	lastError: string | null;
	deployment: string;
	transport: string | null;
	compute: string;
	database: string;
	installed: boolean;
	attached: boolean;
	configured: boolean;
	available: boolean;
	updatedAt: string | null;
};

function runtimeOf(value: unknown): Record<string, any> {
	return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function cleanBaseUrl(value: string, fallback: string) {
	const raw = String(value || fallback).trim();
	const parsed = new URL(raw);
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw Object.assign(new Error('OrbitFS service URL must be public HTTPS'), { status: 500, code: 'ENGINE_HOST_URL_INVALID' });
	}
	if (['localhost','127.0.0.1','::1'].includes(parsed.hostname.toLowerCase())) {
		throw Object.assign(new Error('Localhost is not supported for OrbitFS cloud services'), { status: 500, code: 'ENGINE_HOST_URL_INVALID' });
	}
	return `${parsed.protocol}//${parsed.host}`;
}

export function engineHostBaseUrl() {
	const preview = String(env.VERCEL_ENV || '').toLowerCase() === 'preview';
	const fallback = preview
		? String(env.ORBITFS_ENGINE_HOST_PREVIEW_URL || ENGINE_HOST_PREVIEW_URL)
		: ENGINE_HOST_URL;
	return cleanBaseUrl(String(env.ORBITFS_ENGINE_HOST_URL || ''), fallback);
}

export function panelBaseUrl() {
	return cleanBaseUrl(String(env.ORBITFS_PANEL_URL || ''), PANEL_URL);
}

function engineSecret() {
	const secret = String(env.ORBITFS_ENGINE_SECRET || env.ORBITFS_DB_SECRET || '').trim();
	if (!secret) {
		throw Object.assign(new Error('Engine Host shared secret is not configured'), { status: 503, code: 'ENGINE_HOST_SECRET_MISSING' });
	}
	return secret;
}

function signedHeaders(rawBody = '') {
	const secret = engineSecret();
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
	return {
		'content-type': 'application/json',
		'x-orbitfs-engine-secret': secret,
		'x-orbitfs-timestamp': timestamp,
		'x-orbitfs-signature': signature
	};
}

async function parseEngineHostResponse(response: Response) {
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw Object.assign(new Error(body?.error || body?.message || `Engine Host returned ${response.status}`), {
			status: response.status < 500 ? response.status : 503,
			code: body?.code || 'ENGINE_HOST_REQUEST_FAILED'
		});
	}
	return body;
}

async function mainWorkspace() {
	const db = getSupabaseAdmin();
	let result = await db.from('orbitfs_workspaces').select('id,name,is_main,status').eq('is_main', true).neq('status', 'archived').limit(1).maybeSingle();
	if (result.error) throw result.error;
	if (!result.data) {
		result = await db.from('orbitfs_workspaces').select('id,name,is_main,status').neq('status', 'archived').order('created_at', { ascending: true }).limit(1).maybeSingle();
		if (result.error) throw result.error;
	}
	if (!result.data) throw Object.assign(new Error('OrbitFS has no workspace available for Engine Host pairing'), { status: 409, code: 'WORKSPACE_REQUIRED' });
	return result.data;
}

export async function pairWithEngineHost(engineId: string, actorUserId: string) {
	const workspace = await mainWorkspace();
	const body = JSON.stringify({
		action: 'attach',
		engineId,
		installationId: await ensureInstallationIdentity(),
		panelUrl: panelBaseUrl(),
		workspaceId: String(workspace.id),
		actorUserId,
		attached: true
	});
	const response = await fetch(`${engineHostBaseUrl()}/api/engine/link`, {
		method: 'POST',
		headers: signedHeaders(body),
		body,
		signal: AbortSignal.timeout(Number(env.ORBITFS_ENGINE_TIMEOUT_MS || 8000))
	});
	return parseEngineHostResponse(response);
}

export async function detachFromEngineHost(engineId: string, actorUserId: string) {
	const body = JSON.stringify({ action: 'detach', engineId, actorUserId });
	const response = await fetch(`${engineHostBaseUrl()}/api/engine/link`, {
		method: 'POST',
		headers: signedHeaders(body),
		body,
		signal: AbortSignal.timeout(Number(env.ORBITFS_ENGINE_TIMEOUT_MS || 8000))
	});
	return parseEngineHostResponse(response);
}

export async function getRemoteEngineLink(engineId: string) {
	const response = await fetch(`${engineHostBaseUrl()}/api/engine/link?engine=${encodeURIComponent(engineId)}`, {
		headers: signedHeaders(),
		signal: AbortSignal.timeout(Number(env.ORBITFS_ENGINE_TIMEOUT_MS || 8000)),
		cache: 'no-store'
	});
	return parseEngineHostResponse(response);
}

export async function getEngineStatus(addonId: string): Promise<EngineState> {
	const db = getSupabaseAdmin();
	const { data, error } = await db
		.from('orbitfs_addons')
		.select('id,name,runtime,installed,attached,configured,available,updated_at')
		.eq('id', addonId)
		.maybeSingle();
	if (error) throw error;
	if (!data) throw Object.assign(new Error('Unknown add-on engine'), { status: 404, code: 'ENGINE_NOT_FOUND' });

	const runtime = runtimeOf(data.runtime);
	const rawMode = String(runtime.engineMode || 'standby');
	const mode: EngineMode = ['running', 'standby', 'stopped'].includes(rawMode)
		? (rawMode as EngineMode)
		: 'standby';

	return {
		addonId: String(data.id),
		name: String(data.name || data.id),
		mode,
		generation: Number(runtime.generation || 1),
		lastRequestAt: runtime.lastRequestAt || null,
		lastControlAt: runtime.lastControlAt || null,
		lastControlBy: runtime.lastControlBy || null,
		lastError: runtime.lastError || null,
		deployment: String(runtime.deployment || 'ready'),
		transport: runtime.transport || (addonId === 'mcp' ? '/mcp' : null),
		compute: String(runtime.compute || 'vercel'),
		database: String(runtime.database || 'supabase'),
		installed: data.installed === true,
		attached: data.attached === true,
		configured: data.configured === true,
		available: data.available === true,
		updatedAt: data.updated_at || null
	};
}

export async function controlEngine(
	addonId: string,
	action: 'running' | 'standby' | 'stopped' | 'restart',
	actor: string
): Promise<EngineState> {
	const db = getSupabaseAdmin();
	const current = await getEngineStatus(addonId);
	const { data: row, error: readError } = await db
		.from('orbitfs_addons')
		.select('runtime')
		.eq('id', addonId)
		.maybeSingle();
	if (readError) throw readError;

	const runtime = runtimeOf(row?.runtime);
	const now = new Date().toISOString();
	const nextMode: EngineMode = action === 'restart' ? 'running' : action;
	const nextRuntime = {
		...runtime,
		engineMode: nextMode,
		generation: action === 'restart' ? current.generation + 1 : current.generation,
		lastControlAt: now,
		lastControlBy: actor,
		lastError: null,
		online: nextMode !== 'stopped',
		deployment: 'ready',
		compute: 'vercel',
		database: 'supabase'
	};

	const { error } = await db
		.from('orbitfs_addons')
		.update({ runtime: nextRuntime, updated_at: now })
		.eq('id', addonId);
	if (error) throw error;

	return getEngineStatus(addonId);
}
