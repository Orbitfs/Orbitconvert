<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { addons as addonsStore } from '$lib/addons.svelte';
	import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { Activity, ExternalLink, LoaderCircle, PlugZap, RefreshCw, ShieldCheck, Trash2 } from '@lucide/svelte';

	type Addon = {
		id:string; name:string; description:string; version:string;
		installed:boolean; attached:boolean; licensed:boolean; available:boolean;
		configured:boolean; setupComplete:boolean; setupState:string; status:string;
		deploymentUrl?:string|null; transportPath?:string|null; engineHostUrl?:string|null; engineManageUrl?:string|null;
		licenseState?:string; supports?:string[]; runtime?:Record<string,any>;
	};

	let addons=$state<Addon[]>([]), loading=$state(true), error=$state(''), busy=$state('');
	const message=(e:unknown,fallback:string)=>e instanceof ApiError?e.message:fallback;
	const ENGINE_HOST='https://orbitfsengine.vercel.app';

	async function load(){
		loading=true; error='';
		try {
			const data=await api.get<{addons:Addon[]}>('/addons');
			addons=data.addons;
		} catch(e){ error=message(e,'Could not load OrbitFS engines'); }
		finally { loading=false; }
	}
	load();

	async function act(id:string,action:string){
		busy=`${id}:${action}`; error='';
		try { await api.post(`/addons/${id}/${action}`); await load(); await addonsStore.load(); }
		catch(e){ error=message(e,`${action} failed`); }
		finally { busy=''; }
	}

	async function remove(id:string){
		if(!confirm('Uninstall this engine? Engine data is preserved.')) return;
		busy=`${id}:remove`; error='';
		try { await api.delete(`/addons/${id}`); await load(); await addonsStore.load(); }
		catch(e){ error=message(e,'Uninstall failed'); }
		finally { busy=''; }
	}

	const tone=(a:Addon)=>!a.installed?'secondary':!a.licensed?'destructive':a.setupState==='required'||a.setupState==='in_progress'?'warning':a.attached?'success':'secondary';
	const setupLabel=(a:Addon)=>a.setupState==='complete'?'Complete':a.setupState==='in_progress'?'In progress':a.setupState==='required'?'Required':'Not started';
	const runtimeLabel=(a:Addon)=>String(a.runtime?.engineMode || 'standby');
	const manageUrl=(a:Addon)=>a.engineManageUrl || `${ENGINE_HOST}/engines/${a.id}`;
</script>

<div class="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
	<header class="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
		<div>
			<div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-primary"><Activity class="size-4"/> Engine management</div>
			<h1 class="mt-1 text-2xl font-semibold">OrbitFS Engines</h1>
			<p class="text-sm text-muted-foreground">Panel installs, licenses and attaches engines. Detailed setup, configuration and monitoring live in OrbitFS Engine Host.</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<a href={ENGINE_HOST} target="_blank" rel="noreferrer" class="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"><ExternalLink class="size-4"/>Engine Host</a>
			<Button variant="outline" onclick={load} disabled={loading}><RefreshCw class="size-4"/>Refresh</Button>
		</div>
	</header>

	<div class="rounded-lg border bg-muted/10 p-4 text-sm">
		<div class="font-medium">Panel ↔ Engine Host</div>
		<p class="mt-1 text-muted-foreground">Install → licence → attach → secure Engine Host pairing → first-time setup. Library, Knowledge, Profiles, Projects, OSS and CCS remain owned by Panel.</p>
		<div class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>Panel: <b class="text-foreground">orbitfs.vercel.app</b></span><span>Engine Host: <b class="text-foreground">orbitfsengine.vercel.app</b></span><span>MCP: <b class="text-foreground">orbitfsengine.vercel.app/mcp</b></span></div>
	</div>

	{#if error}<div class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>{/if}
	{#if loading}
		<div class="grid min-h-64 place-items-center"><LoaderCircle class="size-7 animate-spin"/></div>
	{:else}
		<div class="grid gap-4">
			{#each addons as addon (addon.id)}
				<Card>
					<CardHeader>
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<div class="flex flex-wrap items-center gap-2">
									<CardTitle>{addon.name}</CardTitle>
									{#if addon.version}<Badge variant="outline">v{addon.version}</Badge>{/if}
									<Badge variant={tone(addon)}>{addon.status.replaceAll('_',' ')}</Badge>
								</div>
								<CardDescription class="mt-1">{addon.description}</CardDescription>
							</div>
							<Badge variant={addon.licensed?'success':'destructive'}>{addon.licensed?'Licensed':'Licence required'}</Badge>
						</div>
					</CardHeader>
					<CardContent class="space-y-4">
						<div class="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
							<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Installed</span><p class="mt-1 font-medium">{addon.installed?'Yes':'No'}</p></div>
							<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Attached</span><p class="mt-1 font-medium">{addon.attached?'Yes':'No'}</p></div>
							<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Setup</span><p class="mt-1 font-medium">{setupLabel(addon)}</p></div>
							<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Runtime</span><p class="mt-1 font-medium capitalize">{runtimeLabel(addon)}</p></div>
							<div class="rounded-lg border p-3"><span class="text-xs text-muted-foreground">Host</span><p class="mt-1 truncate font-medium">Engine Host</p></div>
						</div>

						<div class="rounded-lg border bg-muted/10 p-3 text-sm">
							<div class="flex flex-wrap items-center justify-between gap-3">
								<div class="min-w-0"><span class="text-xs text-muted-foreground">Engine service</span><p class="mt-1 truncate font-medium">{addon.engineHostUrl || ENGINE_HOST}</p>{#if addon.id==='mcp'}<p class="mt-1 text-xs text-muted-foreground">MCP transport: {ENGINE_HOST}/mcp · OAuth authority: https://orbitfs.vercel.app</p>{/if}</div>
								<Badge variant={addon.attached?'success':'outline'}>{addon.attached?'Paired':'Not paired'}</Badge>
							</div>
						</div>

						<div class="flex flex-wrap gap-2">
							{#if !addon.installed}<Button onclick={()=>act(addon.id,'install')} disabled={busy!==''}>Install</Button>{/if}
							{#if addon.installed}<Button variant="outline" onclick={()=>act(addon.id,'test')} disabled={busy!==''}><ShieldCheck class="size-4"/>Test host</Button>{/if}
							{#if addon.installed && !addon.attached}<Button onclick={()=>act(addon.id,'attach')} disabled={busy!=='' || !addon.licensed}><PlugZap class="size-4"/>Attach</Button>{/if}
							{#if addon.attached && addon.setupState!=='complete'}<a href={`${manageUrl(addon)}/setup`} target="_blank" rel="noreferrer" class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"><ExternalLink class="size-4"/>Complete setup</a>{/if}
							{#if addon.attached && addon.setupState==='complete'}<a href={manageUrl(addon)} target="_blank" rel="noreferrer" class="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"><ExternalLink class="size-4"/>Manage engine</a>{/if}
							{#if addon.attached}<Button variant="outline" onclick={()=>act(addon.id,'detach')} disabled={busy!==''}>Detach</Button>{/if}
							{#if addon.installed}<Button variant="ghost" class="text-destructive" onclick={()=>remove(addon.id)} disabled={busy!=='' || addon.attached}><Trash2 class="size-4"/>Uninstall</Button>{/if}
						</div>

						<div class="rounded-lg border bg-muted/10 p-3 text-xs text-muted-foreground">
							Panel owns installation, licensing, attachment and workspace access. Engine Host owns first-time setup, deep configuration, runtime monitoring, logs and diagnostics. Setup and runtime are independent states.
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
