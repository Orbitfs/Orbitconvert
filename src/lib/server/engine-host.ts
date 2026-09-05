import { getSupabaseAdmin } from '$lib/server/supabase';

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
