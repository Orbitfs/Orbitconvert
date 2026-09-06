import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth';
import { assertPanelLicensed } from '$lib/server/license';
import { writeAudit } from '$lib/server/audit';
import { listCloudAddons } from '$lib/server/cloud-addons';
import {
	FILE_ACTIONS, MANAGEMENT_ACTIONS, MANAGEMENT_LABELS, createWorkspace, effectiveUserPermissions,
	isSystemAdmin, readWorkspaceSettings, visibleWorkspaces
} from '$lib/server/workspaces';

function fail(error: any) {
	const status = Number(error?.status || 500);
	return json({ error:String(error?.message || 'Request failed'), code:String(error?.code || 'REQUEST_FAILED') }, { status });
}

export async function GET({ cookies }) {
	try {
		const user = await requireUser(cookies);
		await assertPanelLicensed();
		const [workspaces, cloudAddons, settings, userPermissions] = await Promise.all([
			visibleWorkspaces(user),
			listCloudAddons().catch(() => []),
			readWorkspaceSettings(),
			effectiveUserPermissions(user)
		]);
		const mcpAddon = cloudAddons.find((addon:any) => addon.id === 'mcp');
		const currentManagementActions = MANAGEMENT_ACTIONS.filter((id)=>!id.startsWith('sorter_')&&!id.startsWith('converter_'));
		return json({
			workspaces, settings, canManageGlobal:isSystemAdmin(user),
			userPermissions, roles:['owner','editor','contributor','viewer'],
			fileActions:[...FILE_ACTIONS], managementActions:[...currentManagementActions], managementLabels:MANAGEMENT_LABELS,
			managementCatalog:{ groups:[
				{id:'base',label:'Workspace permissions',addonId:'base',attached:true,permissions:currentManagementActions.filter((id)=>!id.startsWith('mcp_')&&!id.startsWith('manage_mcp_')&&!id.startsWith('studio_'))},
				{id:'mcp',label:'MCP',addonId:'mcp',attached:mcpAddon?.attached===true,permissions:currentManagementActions.filter((id)=>id==='mcp_use'||id.startsWith('manage_mcp_'))},
				{id:'studio',label:'Studio',addonId:'studio',attached:true,permissions:currentManagementActions.filter((id)=>id.startsWith('studio_'))}
			],labels:MANAGEMENT_LABELS,count:currentManagementActions.length}, currentUser:{id:user.id,username:user.username,role:user.role},
			ownedCount:workspaces.filter((ws:any) => ws.permission === 'owner' && !ws.is_main).length
		}, { headers:{ 'cache-control':'private, no-store' } });
	} catch (error) { return fail(error); }
}
export async function POST({ request, cookies }) {
	try {
		const user = await requireUser(cookies);
		await assertPanelLicensed();
		const body = await request.json().catch(() => ({}));
		const workspace = await createWorkspace(user,body);
		await writeAudit({
			actorUserId:user.id, workspaceId:workspace.id, action:'workspace.create',
			targetType:'workspace', targetId:workspace.id, detail:{ name:workspace.name }
		});
		return json({ workspace });
	} catch (error) { return fail(error); }
}