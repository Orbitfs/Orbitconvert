import { getSupabaseAdmin } from '$lib/server/supabase';
import { getPanelLicenseSummary, activateLicenseComponent } from '$lib/server/license';
import { ENGINE_HOST_URL } from '$lib/server/engine-host';

export const CLOUD_ADDON_MANIFESTS: Record<string, any> = {
	mcp: {
		id: 'mcp', name: 'OrbitFS MCP', version: '1.5.0',
		description: 'Context, tools, OAuth and MCP client runtime for OrbitFS.',
		licenseComponent: 'orbitfs_mcp', kind: 'engine', runtimeMode: 'engine-host',
		deploymentUrl: ENGINE_HOST_URL, transportPath: '/mcp', sourceRef: 'orbitfsengine:mcp',
		capabilities: ['mcp','oauth-2.1','pkce','startup','context','chatgpt-ui','mcp-apps']
	},
	apex: {
		id: 'apex', name: 'OrbitFS APEX', version: '',
		description: 'Routing, processing and automation engine for OrbitFS workspace data.',
		licenseComponent: 'orbitfs_apex', kind: 'engine', runtimeMode: 'engine-host',
		deploymentUrl: ENGINE_HOST_URL, transportPath: null, sourceRef: 'orbitfsengine:apex',
		capabilities: ['routing','processing','automation','providers']
	},
	studio: {
		id: 'studio', name: 'OrbitFS Studio', version: '',
		description: 'Studio processing and analysis runtime backed by Panel-owned Studio data.',
		licenseComponent: 'orbitfs_studio', kind: 'engine', runtimeMode: 'engine-host',
		deploymentUrl: ENGINE_HOST_URL, transportPath: null, sourceRef: 'orbitfsengine:studio',
		capabilities: ['studio-runtime','analysis','processing','providers']
	}
};

function syntheticRow(manifest: any) {
	return {
		id: manifest.id,
		name: manifest.name,
		description: manifest.description || '',
		version: manifest.version || '',
		license_component: manifest.licenseComponent || null,
		available: true,
		installed: false,
		attached: false,
		configured: false,
		status: 'registered',
		deployment_url: manifest.deploymentUrl || null,
		transport_path: manifest.transportPath || null,
		source_ref: manifest.sourceRef || null,
		config: {},
		manifest,
		runtime: {},
		installed_at: null,
		updated_at: null
	};
}

function explicitSetupState(row: any) {
	const runtime = row?.runtime && typeof row.runtime === 'object' ? row.runtime : {};
	const config = row?.config && typeof row.config === 'object' ? row.config : {};
	const setup = config.engineSetup && typeof config.engineSetup === 'object' ? config.engineSetup : {};
	const state = String(runtime.setupState || setup.state || '');
	if (['not_started','required','in_progress','complete','error'].includes(state)) return state;
	return row?.attached ? 'required' : 'not_started';
}

export async function addonLicensed(component?: string | null) {
	if (!component) return true;
	let summary = await getPanelLicenseSummary();
	let item = summary.components?.[component] || {};
	const needsActivation = item.allowed === true && item.lockedToThisInstallation !== true &&
		(item.state === 'active' || item.reason === 'activation_required');
	if (needsActivation) {
		try {
			await activateLicenseComponent(component);
			summary = await getPanelLicenseSummary({ refresh: true });
			item = summary.components?.[component] || {};
		} catch { /* remain blocked below */ }
	}
	return item.allowed === true && item.lockedToThisInstallation === true && ['enabled','locked'].includes(String(item.state));
}

export async function listCloudAddons() {
	const supabase = getSupabaseAdmin();
	const result = await supabase.from('orbitfs_addons').select('*').order('name');
	if (result.error) throw result.error;
	const rows = result.data ?? [];
	const byId = new Map(rows.map((row: any) => [String(row.id), row]));
	const ordered = Object.values(CLOUD_ADDON_MANIFESTS).map((manifest: any) => byId.get(manifest.id) || syntheticRow(manifest));
	for (const row of rows) if (!CLOUD_ADDON_MANIFESTS[String(row.id)]) ordered.push(row);
	return Promise.all(ordered.map(presentAddon));
}

export async function getCloudAddon(id: string) {
	const supabase = getSupabaseAdmin();
	const result = await supabase.from('orbitfs_addons').select('*').eq('id',id).maybeSingle();
	if (result.error) throw result.error;
	if (result.data) return result.data;
	const manifest = CLOUD_ADDON_MANIFESTS[id];
	if (manifest) return syntheticRow(manifest);
	throw Object.assign(new Error('Add-on not found'), { status:404 });
}

export async function ensureCloudAddonRecord(id: string) {
	const existing = await getCloudAddon(id);
	if (existing.updated_at) return existing;
	const manifest = CLOUD_ADDON_MANIFESTS[id];
	if (!manifest) throw Object.assign(new Error('Add-on not found'), { status:404 });
	const supabase = getSupabaseAdmin();
	const payload = syntheticRow(manifest);
	delete payload.updated_at;
	const result = await supabase.from('orbitfs_addons').insert(payload).select('*').single();
	if (result.error) throw result.error;
	return result.data;
}

export async function presentAddon(row: any) {
	const catalogManifest = CLOUD_ADDON_MANIFESTS[String(row.id)] || {};
	const manifest = { ...catalogManifest, ...(row.manifest || {}) };
	const component = row.license_component || manifest.licenseComponent || null;
	const licensed = await addonLicensed(component);
	const installed = row.installed === true;
	const attached = installed && row.attached === true && licensed;
	const setupState = explicitSetupState(row);
	const setupComplete = setupState === 'complete';
	const base = String(manifest.deploymentUrl || row.deployment_url || '').replace(/\/$/,'');
	const engineHosted = manifest.runtimeMode === 'engine-host';
	const link = (href: string) => engineHosted ? href : (base && href?.startsWith('/') ? base + href : href);
	const frontend = manifest.frontend ? { ...manifest.frontend, navigationGroups:(manifest.frontend.navigationGroups||[]).map((group:any)=>({...group,items:(group.items||[]).map((item:any)=>({...item,href:link(item.href)}))})), adminGroups:(manifest.frontend.adminGroups||[]).map((group:any)=>({...group,items:(group.items||[]).map((item:any)=>({...item,href:link(item.href)}))})), primaryNavigation:(manifest.frontend.primaryNavigation||[]).map((item:any)=>({...item,href:link(item.href)})), routes:[] } : null;
	return {
		id:row.id,name:row.name || manifest.name,description:row.description || manifest.description,version:row.version || manifest.version || '',
		installed,attached,parked:installed && !attached,licensed,available:row.available !== false,
		configured:setupComplete,setupComplete,setupState,
		needsSetup:attached && !setupComplete,status:!licensed && installed ? 'unlicensed' : attached ? (setupComplete ? 'attached' : 'setup_required') : installed ? 'detached' : 'registered',
		licenseState:licensed ? 'enabled':'blocked',installStatus:installed ? 'installed':'registered',
		installMethod:'cloud',supports:['install','test','attach','detach','uninstall'],
		deploymentUrl:base || null,transportPath:row.transport_path ?? manifest.transportPath ?? null,sourceRef:row.source_ref || manifest.sourceRef || null,
		online:Boolean(row.runtime?.online),manifest,frontend,runtime:row.runtime || {},config:row.config || {},
		engineHostUrl: engineHosted ? ENGINE_HOST_URL : null,
		engineManageUrl: engineHosted ? `${ENGINE_HOST_URL}/engines/${row.id}` : null,
		wiring:{ package:false,panel:true,backend:installed,frontend:false,engine:installed,service:false }
	};
}

export async function saveCloudAddon(id: string, patch: Record<string, any>) {
	const supabase = getSupabaseAdmin();
	const result = await supabase.from('orbitfs_addons').update({ ...patch,updated_at:new Date().toISOString() }).eq('id',id).select('*').single();
	if (result.error) throw result.error;
	return presentAddon(result.data);
}
