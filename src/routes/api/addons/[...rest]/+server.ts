import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { activateLicenseComponent, assertPanelLicensed } from '$lib/server/license';
import { isSystemAdmin } from '$lib/server/workspaces';
import {
	CLOUD_ADDON_MANIFESTS,
	addonLicensed,
	ensureCloudAddonRecord,
	getCloudAddon,
	presentAddon,
	saveCloudAddon
} from '$lib/server/cloud-addons';
import {
	ENGINE_HOST_URL,
	detachFromEngineHost,
	getRemoteEngineLink,
	pairWithEngineHost
} from '$lib/server/engine-host';
import { writeAudit } from '$lib/server/audit';

const clean = (v: unknown) => String(v ?? '').trim();
const fail = (e: any) => json({ error:String(e?.message || 'Request failed'),code:String(e?.code || 'ADDON_ERROR') }, { status:Number(e?.status || 500) });
const isEngineHostAddon = (id: string) => CLOUD_ADDON_MANIFESTS[id]?.runtimeMode === 'engine-host';

async function context(cookies: any) {
	const user = await requireUser(cookies);
	await assertPanelLicensed();
	if (!isSystemAdmin(user)) throw Object.assign(new Error('System Owner or Admin required'), { status:403 });
	return user;
}

export async function GET({ params,cookies }: any) {
	try {
		await context(cookies);
		const parts=clean(params.rest).split('/').filter(Boolean);
		const row=await getCloudAddon(parts[0]);
		const addon=await presentAddon(row);
		if (parts.length===1 || parts[1]==='details') return json({
			manifest:addon.manifest,
			registration:addon.manifest?.frontend || {},
			schema:addon.manifest?.configSchema || {properties:{}},
			install:{installedAt:row.installed_at,version:row.version,schemaVersion:2,installMethod:'cloud',setupComplete:addon.setupComplete},
			config:row.config || {},
			meta:addon
		});
		if (parts[1]==='runtime') return json({
			online:addon.online,
			mode:isEngineHostAddon(row.id)?'engine-host':'cloud',
			workspaceIntegration:true,
			licensed:addon.licensed,
			attached:addon.attached,
			setupState:addon.setupState,
			publicBaseUrl:addon.deploymentUrl,
			connectorPath:addon.transportPath,
			health:{ online:addon.online,running:String(row.runtime?.engineMode || '')==='running',service:isEngineHostAddon(row.id)?'OrbitFS Engine Host':'Vercel' }
		});
		if (parts[1]==='connection') return json({
			mode:isEngineHostAddon(row.id)?'engine-host':'cloud',
			resource:addon.transportPath && addon.deploymentUrl ? `${String(addon.deploymentUrl).replace(/\/$/,'')}${addon.transportPath}` : addon.deploymentUrl,
			connectorPath:addon.transportPath,
			issuer:row.id==='mcp'?'https://orbitfs.vercel.app':addon.deploymentUrl,
			engineHostUrl:addon.engineHostUrl,
			manageUrl:addon.engineManageUrl
		});
		throw Object.assign(new Error('Not found'),{status:404});
	} catch(e){ return fail(e); }
}

export async function PATCH({ params,request,cookies }: any) {
	try {
		const user=await context(cookies);
		const parts=clean(params.rest).split('/').filter(Boolean);
		let row=await getCloudAddon(parts[0]);
		if (parts[1]!=='config') throw Object.assign(new Error('Not found'),{status:404});
		if (!row.updated_at) row=await ensureCloudAddonRecord(parts[0]);
		const body=await request.json().catch(()=>({}));
		const config={ ...(row.config || {}),...body };
		delete config.deploymentUrl;
		const deploymentUrl=isEngineHostAddon(row.id)?ENGINE_HOST_URL:(clean(body.deploymentUrl || row.deployment_url) || null);
		const addon=await saveCloudAddon(row.id,{ config,deployment_url:deploymentUrl,status:row.attached?'attached':'detached' });
		await writeAudit({ actorUserId:user.id,action:'addon.config',targetType:'addon',targetId:row.id,detail:{engineHost:isEngineHostAddon(row.id),deploymentUrl:Boolean(deploymentUrl)} });
		return json({ ok:true,addon });
	} catch(e){ return fail(e); }
}

export async function POST({ params,cookies }: any) {
	try {
		const user=await context(cookies);
		const parts=clean(params.rest).split('/').filter(Boolean);
		const id=parts[0];
		const action=parts[1] || '';

		if (action==='install') {
			const row=await ensureCloudAddonRecord(id);
			const engineHosted=isEngineHostAddon(id);
			const deploymentUrl=engineHosted?ENGINE_HOST_URL:row.deployment_url;
			const runtime={
				...(row.runtime||{}),
				mode:engineHosted?'engine-host':'external-vercel',
				engineMode:row.runtime?.engineMode || 'standby',
				setupState:row.runtime?.setupState || 'not_started',
				compute:'vercel',database:'supabase',online:false
			};
			const addon=await saveCloudAddon(row.id,{
				installed:true,
				attached:false,
				configured:false,
				status:'detached',
				installed_at:row.installed_at || new Date().toISOString(),
				deployment_url:deploymentUrl,
				transport_path:row.transport_path ?? CLOUD_ADDON_MANIFESTS[id]?.transportPath ?? null,
				runtime
			});
			await writeAudit({actorUserId:user.id,action:'addon.install',targetType:'addon',targetId:row.id,detail:{engineHost:engineHosted}});
			return json({ok:true,addon});
		}

		let row=await getCloudAddon(id);
		if (!row.updated_at) throw Object.assign(new Error('Install the engine first'),{status:409,code:'ENGINE_NOT_INSTALLED'});

		if (action==='attach') {
			if (!row.installed) throw Object.assign(new Error('Install the engine first'),{status:409});
			if (!(await addonLicensed(row.license_component)) && row.license_component) await activateLicenseComponent(row.license_component);
			if (!(await addonLicensed(row.license_component))) throw Object.assign(new Error('This installation is not licensed for this engine'),{status:403,code:'LICENSE_REQUIRED'});
			if (isEngineHostAddon(id)) {
				if (row.deployment_url !== ENGINE_HOST_URL) row=await (async()=>{ await saveCloudAddon(id,{deployment_url:ENGINE_HOST_URL}); return getCloudAddon(id); })();
				const link=await pairWithEngineHost(id,String(user.id));
				await writeAudit({actorUserId:user.id,action:'engine.attach',targetType:'addon',targetId:id,detail:{engineHost:ENGINE_HOST_URL,linkState:link?.state?.linkState || link?.state?.setupState || null}});
				return json({ok:true,addon:await presentAddon(await getCloudAddon(id)),engineHost:link});
			}
			if (!row.deployment_url) throw Object.assign(new Error('Configure the cloud deployment URL first'),{status:409});
			const addon=await saveCloudAddon(id,{attached:true,status:'attached'});
			await writeAudit({actorUserId:user.id,action:'addon.attach',targetType:'addon',targetId:id});
			return json({ok:true,addon});
		}

		if (action==='detach') {
			if (isEngineHostAddon(id)) {
				const remote=await detachFromEngineHost(id,String(user.id));
				await writeAudit({actorUserId:user.id,action:'engine.detach',targetType:'addon',targetId:id,detail:{engineHost:ENGINE_HOST_URL}});
				return json({ok:true,addon:await presentAddon(await getCloudAddon(id)),engineHost:remote});
			}
			const addon=await saveCloudAddon(id,{attached:false,status:'detached'});
			await writeAudit({actorUserId:user.id,action:'addon.detach',targetType:'addon',targetId:id});
			return json({ok:true,addon});
		}

		if (action==='test') {
			if (isEngineHostAddon(id)) {
				const remote=await getRemoteEngineLink(id);
				await saveCloudAddon(id,{runtime:{...(row.runtime||{}),lastTestedAt:new Date().toISOString(),engineHostReachable:true,httpStatus:200,compute:'vercel',database:'supabase'}});
				return json({ok:true,online:true,httpStatus:200,engineHost:ENGINE_HOST_URL,state:remote});
			}
			if (!row.deployment_url) throw Object.assign(new Error('Cloud deployment URL is not configured'),{status:409});
			const base=String(row.deployment_url).replace(/\/$/,'');
			let online=false,status=0;
			try { const response=await fetch(`${base}/api/setup/status`,{method:'GET',signal:AbortSignal.timeout(5000)}); status=response.status; online=response.status<500; } catch { online=false; }
			await saveCloudAddon(id,{runtime:{...(row.runtime||{}),online,lastTestedAt:new Date().toISOString(),httpStatus:status},status:online?(row.attached?'attached':'detached'):'error'});
			if (!online) throw Object.assign(new Error('Cloud add-on deployment is not reachable'),{status:503});
			return json({ok:true,online,httpStatus:status});
		}

		if (action==='repair') return json({ok:true,mode:isEngineHostAddon(id)?'engine-host':'cloud',message:isEngineHostAddon(id)?'Engine Host is managed as a Vercel service; use Test and Diagnostics instead of Windows repair.':'Cloud add-ons do not require Windows service repair.'});
		throw Object.assign(new Error('Not found'),{status:404});
	} catch(e){ return fail(e); }
}

export async function DELETE({ params,cookies }: any) {
	try {
		const user=await context(cookies);
		const parts=clean(params.rest).split('/').filter(Boolean);
		const row=await getCloudAddon(parts[0]);
		if (parts.length!==1) throw Object.assign(new Error('Not found'),{status:404});
		if (!row.updated_at || !row.installed) return json({ok:true,preservedData:true,addon:await presentAddon(row)});
		if (row.attached) throw Object.assign(new Error('Detach the engine before uninstalling it'),{status:409,code:'ENGINE_ATTACHED'});
		const manifest=CLOUD_ADDON_MANIFESTS[row.id];
		const addon=await saveCloudAddon(row.id,{
			installed:false,attached:false,configured:false,status:'registered',
			deployment_url:manifest?.deploymentUrl || null,
			config:{},
			runtime:{mode:manifest?.runtimeMode || 'external-vercel',engineMode:'standby',setupState:'not_started',compute:'vercel',database:'supabase'}
		});
		await writeAudit({actorUserId:user.id,action:'addon.uninstall',targetType:'addon',targetId:row.id,detail:{preservedData:true}});
		return json({ok:true,preservedData:true,addon});
	} catch(e){ return fail(e); }
}
