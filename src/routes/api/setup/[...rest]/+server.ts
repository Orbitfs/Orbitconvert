import { json } from '@sveltejs/kit';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { getPanelLicenseSummary } from '$lib/server/license';
import { STORAGE_BUCKET } from '$lib/server/base-compat';
import { engineHostBaseUrl } from '$lib/server/engine-host';

async function setupModel(origin = '') {
	const supabase = getSupabaseAdmin();
	const [{ count, error }, bucket] = await Promise.all([
		supabase.from('orbitfs_users').select('*', { count: 'exact', head: true }),
		supabase.storage.getBucket(STORAGE_BUCKET)
	]);
	if (error) throw error;
	const complete = (count ?? 0) > 0;
	const storageReady = !bucket.error && Boolean(bucket.data);
	const engineHostUrl = engineHostBaseUrl();
	return {
		setupComplete: complete,
		needsSetup: !complete,
		currentStep: complete ? 'complete' : 'owner',
		coreRequired: ['Vercel runtime', 'Supabase database', 'Supabase Storage'],
		config: {
			publicOrigin: origin,
			backendPort: 'managed by Vercel',
			apiBase: '/api',
			deployMode: 'vercel',
			storageRoot: `Supabase Storage / ${STORAGE_BUCKET}`,
			workspaceRoot: 'Supabase orbitfs_workspaces + orbitfs_files',
			systemRoot: 'Supabase orbitfs_* tables',
			engineHostUrl,
			mcpEndpoint: `${engineHostUrl}/mcp`,
			licenseApiUrl: 'https://orbitfs.vercel.app/api/license/v1'
		},
		steps: {
			step1: { complete: true, configured: true, title: 'Vercel runtime', description: 'SvelteKit Panel and API are deployed on Vercel.' },
			step2: { complete: storageReady, configured: storageReady, bootstrapped: storageReady, title: 'Supabase data layer', description: storageReady ? 'Postgres metadata and object storage are available.' : 'Supabase Storage is not currently available.' },
			owner: { complete, title: 'First owner', description: 'Create the protected OrbitFS owner account.' }
		},
		addons: [],
		notes: [
			'OrbitFS Panel is the main control plane.',
			'Workspace files and Library paths are virtual records backed by Supabase, not folders on a persistent server drive.',
			'MCP, APEX and Studio engines are managed by the OrbitFS Engine Host after they are installed and attached from Panel.',
			`Engine Host: ${engineHostUrl}`,
			`MCP endpoint: ${engineHostUrl}/mcp`
		]
	};
}

function failure(error: any) {
	return json({ error: error?.message ?? 'Setup request failed' }, { status: Number(error?.status || 500) });
}

export async function GET({ params, url }) {
	try {
		if (String(params.rest || '') !== 'config') return json({ error: 'Not found' }, { status: 404 });
		return json(await setupModel(url.origin));
	} catch (error) { return failure(error); }
}

export async function PUT({ params, url }) {
	try {
		if (String(params.rest || '') !== 'config') return json({ error: 'Not found' }, { status: 404 });
		return json(await setupModel(url.origin));
	} catch (error) { return failure(error); }
}

export async function POST({ params, request, url }) {
	try {
		const rest = String(params.rest || '');
		if (rest === 'bootstrap') return json({ ok: true, ...(await setupModel(url.origin)) });
		if (rest === 'test-link') {
			const body = await request.json().catch(() => ({}));
			const target = String(body.target ?? '');
			if (target === 'license') {
				const status = await getPanelLicenseSummary({ refresh: true });
				return json({ ok: true, message: status.licensed ? 'Licence service connected and Base System is licensed.' : `Licence service connected (${status.reason ?? 'not activated'}).` });
			}
			if (target === 'storage') {
				const supabase = getSupabaseAdmin();
				const bucket = await supabase.storage.getBucket(STORAGE_BUCKET);
				if (bucket.error || !bucket.data) return json({ ok: false, message: bucket.error?.message || 'Supabase Storage bucket is unavailable', status: 503 });
				return json({ ok: true, message: `Supabase Storage bucket ${STORAGE_BUCKET} is available.` });
			}
			return json({ ok: true, message: 'Panel deployment configuration is managed by Vercel and Supabase.' });
		}
		return json({ error: 'Not found' }, { status: 404 });
	} catch (error) { return failure(error); }
}
