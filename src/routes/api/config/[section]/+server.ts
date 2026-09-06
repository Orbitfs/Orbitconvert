import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAdmin } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { engineHostBaseUrl } from '$lib/server/engine-host';

const PANEL_PRODUCTION_URL = 'https://orbitfs.vercel.app';
const LICENSE_API_URL = 'https://orbitfs.vercel.app/api/license/v1';
const STORAGE_BUCKET = 'orbitfs-files';

function definitions(origin: string) {
	const engineHostUrl = engineHostBaseUrl();
	const enginePairingConfigured = Boolean(String(env.ORBITFS_ENGINE_SECRET || env.ORBITFS_DB_SECRET || '').trim());
	return {
		runtime: {
			config: {
				deployMode: 'Vercel',
				runtime: 'SvelteKit on Vercel Functions',
				databaseProvider: 'Supabase Postgres',
				storageProvider: `Supabase Storage / ${STORAGE_BUCKET}`,
				apiBase: `${origin}/api`,
				publicOrigin: origin,
				productionPanelUrl: PANEL_PRODUCTION_URL,
				engineHostUrl,
				mcpEndpoint: `${engineHostUrl}/mcp`,
				licenseApiUrl: LICENSE_API_URL,
				filesystemModel: 'Supabase-backed virtual Library',
				persistentServer: false,
				enginePairingConfigured
			},
			description: 'OrbitFS runs as a Vercel/Supabase cloud application. There is no persistent server filesystem to configure.'
		},
		paths: {
			fields: [
				{ key: 'storageRoot', label: 'Workspace file objects', restartRequired: false, value: `Supabase Storage / ${STORAGE_BUCKET}`, exists: true, description: 'Uploaded files and generated file objects.' },
				{ key: 'workspaceRecords', label: 'Workspace + Library metadata', restartRequired: false, value: 'Supabase Postgres / orbitfs_workspaces + orbitfs_files', exists: true, description: 'Workspace structure, Library records and virtual paths.' },
				{ key: 'systemData', label: 'OrbitFS system data', restartRequired: false, value: 'Supabase Postgres / orbitfs_* tables', exists: true, description: 'Accounts, settings, engines, sessions, permissions and system state.' }
			]
		},
		'ports-urls': {
			fields: [
				{ key: 'publicOrigin', label: 'Current Panel URL', type: 'url', value: origin, description: 'The Panel URL for this deployment.' },
				{ key: 'productionPanelUrl', label: 'Production Panel', type: 'url', value: PANEL_PRODUCTION_URL, description: 'Canonical OrbitFS Panel address.' },
				{ key: 'apiBase', label: 'Panel API', type: 'url', value: `${origin}/api`, description: 'Panel application API.' },
				{ key: 'engineHostUrl', label: 'Engine Host', type: 'url', value: engineHostUrl, description: 'MCP, APEX and Studio engine management.' },
				{ key: 'mcpEndpoint', label: 'MCP endpoint', type: 'url', value: `${engineHostUrl}/mcp`, description: 'Endpoint used by ChatGPT, Cursor and other MCP clients.' },
				{ key: 'licenseApiUrl', label: 'Licence API', type: 'url', value: LICENSE_API_URL, description: 'Canonical OrbitFS master licensing service.' }
			]
		},
		'service-names': {
			fields: [
				{ key: 'panelRuntime', label: 'Panel runtime', value: 'Vercel Functions / SvelteKit' },
				{ key: 'databaseRuntime', label: 'Database', value: 'Supabase Postgres' },
				{ key: 'storageRuntime', label: 'Object storage', value: `Supabase Storage / ${STORAGE_BUCKET}` },
				{ key: 'engineRuntime', label: 'Engine Host', value: engineHostUrl }
			]
		}
	};
}

export async function GET({ params, cookies, url }: any) {
	try {
		await assertPanelLicensed();
		await requireAdmin(cookies);
		const section = String(params.section || 'runtime');
		const result = (definitions(url.origin) as any)[section];
		if (!result) return json({ error: 'Unknown config section' }, { status: 404 });
		return json({
			...result,
			readOnly: true,
			managedBy: section === 'runtime' || section === 'ports-urls' ? 'Vercel + OrbitFS' : 'Supabase'
		});
	} catch (error: any) {
		return json({ error: String(error?.message || 'Config load failed') }, { status: Number(error?.status || 500) });
	}
}

export async function PATCH({ params, cookies }: any) {
	try {
		await requireAdmin(cookies);
		await assertPanelLicensed();
		const section = String(params.section || 'runtime');
		if (!(section in definitions('https://orbitfs.vercel.app'))) return json({ error: 'Unknown config section' }, { status: 404 });
		return json({
			error: 'Deployment infrastructure is intentionally managed by Vercel and Supabase. Change application settings from their dedicated OrbitFS controls instead.',
			code: 'CLOUD_CONFIG_READ_ONLY',
			section
		}, { status: 409 });
	} catch (error: any) {
		return json({ error: String(error?.message || 'Config update failed') }, { status: Number(error?.status || 500) });
	}
}
