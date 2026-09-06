<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input } from '$lib/components/ui';
	import {
		AlertTriangle,
		CheckCircle2,
		Cloud,
		Database,
		ExternalLink,
		Globe,
		HardDriveDownload,
		KeyRound,
		LoaderCircle,
		Network,
		Save,
		ServerCog,
		Settings2,
		ShieldCheck
	} from '@lucide/svelte';

	type RuntimeModel = {
		config: {
			deployMode: string;
			runtime: string;
			databaseProvider: string;
			storageProvider: string;
			apiBase: string;
			publicOrigin: string;
			productionPanelUrl: string;
			engineHostUrl: string;
			mcpEndpoint: string;
			licenseApiUrl: string;
			filesystemModel: string;
			persistentServer: boolean;
			enginePairingConfigured: boolean;
		};
		description?: string;
	};
	type DriveConfig = { clientId: string | null; enabled?: boolean; configured?: boolean };
	type LicenseConfig = {
		providerBase: string;
		diagnostics?: { provider?: { ok?: boolean; status?: number | null; error?: string | null } };
	};

	let runtime = $state<RuntimeModel | null>(null);
	let runtimeLoading = $state(true);
	let runtimeError = $state('');
	let driveClientId = $state('');
	let driveEnabled = $state(false);
	let driveLoading = $state(true);
	let driveSaving = $state(false);
	let driveError = $state('');
	let driveSaved = $state(false);
	let licenseUrl = $state('');
	let licenseLoading = $state(true);
	let licenseSaving = $state(false);
	let licenseTesting = $state(false);
	let licenseError = $state('');
	let licenseMessage = $state('');

	function errorMessage(err: unknown, fallback: string) {
		return err instanceof ApiError ? err.message : fallback;
	}

	async function loadRuntime() {
		runtimeLoading = true;
		runtimeError = '';
		try { runtime = await api.get<RuntimeModel>('/config/runtime'); }
		catch (err) { runtimeError = errorMessage(err, 'Failed to load OrbitFS runtime configuration'); }
		finally { runtimeLoading = false; }
	}

	async function loadDrive() {
		driveLoading = true;
		driveError = '';
		try {
			const result = await api.get<DriveConfig>('/drive-config');
			driveClientId = result.clientId ?? '';
			driveEnabled = result.enabled ?? Boolean(result.clientId);
		} catch (err) { driveError = errorMessage(err, 'Failed to load Google Drive configuration'); }
		finally { driveLoading = false; }
	}

	async function loadLicense() {
		licenseLoading = true;
		licenseError = '';
		try {
			const result = await api.get<LicenseConfig>('/license/provider');
			licenseUrl = result.providerBase || '';
			if (result.diagnostics?.provider?.ok) licenseMessage = 'Licence service reachable.';
		} catch (err) { licenseError = errorMessage(err, 'Failed to load licence service configuration'); }
		finally { licenseLoading = false; }
	}

	async function saveDrive(event: Event) {
		event.preventDefault();
		driveSaving = true;
		driveError = '';
		driveSaved = false;
		try {
			await api.patch('/system/drive-config', { clientId: driveClientId.trim(), enabled: driveEnabled });
			driveSaved = true;
		} catch (err) { driveError = errorMessage(err, 'Google Drive save failed'); }
		finally { driveSaving = false; }
	}

	async function saveLicense(event: Event) {
		event.preventDefault();
		licenseSaving = true;
		licenseError = '';
		licenseMessage = '';
		try {
			const result = await api.put<LicenseConfig>('/license/provider', { providerBase: licenseUrl.trim() });
			licenseUrl = result.providerBase;
			licenseMessage = 'Licence service saved.';
		} catch (err) { licenseError = errorMessage(err, 'Licence service save failed'); }
		finally { licenseSaving = false; }
	}

	async function testLicense() {
		licenseTesting = true;
		licenseError = '';
		licenseMessage = '';
		try {
			const result = await api.post<any>('/license/provider/test', { providerBase: licenseUrl.trim() });
			licenseMessage = result?.provider?.ok
				? `Connected${result.provider.status ? ` · HTTP ${result.provider.status}` : ''}.`
				: `Could not connect${result?.provider?.error ? `: ${result.provider.error}` : '.'}`;
		} catch (err) { licenseError = errorMessage(err, 'Licence service test failed'); }
		finally { licenseTesting = false; }
	}

	loadRuntime();
	loadDrive();
	loadLicense();
</script>

<div class="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
	<div class="space-y-1">
		<h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight"><Settings2 class="size-5 text-muted-foreground" />OrbitFS configuration</h1>
		<p class="max-w-3xl text-sm text-muted-foreground">The actual cloud setup used by OrbitFS. Infrastructure owned by Vercel or Supabase is shown clearly as deployment-managed; OrbitFS settings you can safely change are editable below.</p>
	</div>

	{#if runtimeLoading}
		<Card><CardContent class="flex items-center gap-2 p-5 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading OrbitFS configuration…</CardContent></Card>
	{:else if runtimeError}
		<div class="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{runtimeError}</div>
	{:else if runtime}
		<div class="grid gap-3 md:grid-cols-3">
			<div class="rounded-xl border bg-card p-4">
				<div class="mb-3 flex items-center justify-between"><Cloud class="size-5 text-primary" /><span class="flex items-center gap-1 text-xs text-success"><CheckCircle2 class="size-3.5" />Ready</span></div>
				<p class="font-medium">Panel runtime</p>
				<p class="mt-1 text-sm text-muted-foreground">{runtime.config.runtime}</p>
			</div>
			<div class="rounded-xl border bg-card p-4">
				<div class="mb-3 flex items-center justify-between"><Database class="size-5 text-primary" /><span class="flex items-center gap-1 text-xs text-success"><CheckCircle2 class="size-3.5" />Ready</span></div>
				<p class="font-medium">Data + Library storage</p>
				<p class="mt-1 text-sm text-muted-foreground">Supabase Postgres + Storage. No persistent server filesystem.</p>
			</div>
			<div class="rounded-xl border bg-card p-4">
				<div class="mb-3 flex items-center justify-between"><Network class="size-5 text-primary" />
					{#if runtime.config.enginePairingConfigured}<span class="flex items-center gap-1 text-xs text-success"><CheckCircle2 class="size-3.5" />Paired-ready</span>{:else}<span class="flex items-center gap-1 text-xs text-warning"><AlertTriangle class="size-3.5" />Secret required</span>{/if}
				</div>
				<p class="font-medium">Engine Host connection</p>
				<p class="mt-1 text-sm text-muted-foreground">Panel control channel for MCP, APEX and Studio.</p>
			</div>
		</div>

		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2"><Globe class="size-4" />Core service addresses</CardTitle>
				<CardDescription>These are the addresses OrbitFS is built around. Preview deployments automatically show their current Panel origin while production remains canonical.</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-3 md:grid-cols-2">
				<div class="rounded-lg border p-4"><div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Production Panel</div><div class="mt-1 break-all font-mono text-sm">{runtime.config.productionPanelUrl}</div><p class="mt-2 text-xs text-muted-foreground">Main OrbitFS website and control plane.</p></div>
				<div class="rounded-lg border p-4"><div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Panel API</div><div class="mt-1 break-all font-mono text-sm">{runtime.config.apiBase}</div><p class="mt-2 text-xs text-muted-foreground">API used by this Panel deployment.</p></div>
				<div class="rounded-lg border p-4"><div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Engine Host</div><div class="mt-1 break-all font-mono text-sm">{runtime.config.engineHostUrl}</div><p class="mt-2 text-xs text-muted-foreground">Deep setup, runtime, monitoring and configuration for MCP/APEX/Studio.</p></div>
				<div class="rounded-lg border p-4"><div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">MCP transport</div><div class="mt-1 break-all font-mono text-sm">{runtime.config.mcpEndpoint}</div><p class="mt-2 text-xs text-muted-foreground">Use this endpoint for ChatGPT, Cursor and other MCP clients.</p></div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2"><ServerCog class="size-4" />Cloud platform</CardTitle>
				<CardDescription>These are intentionally deployment-managed because changing them inside the app would break the running deployment.</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-3 sm:grid-cols-2">
				<div class="rounded-lg border p-4"><p class="font-medium">Compute</p><p class="mt-1 text-sm text-muted-foreground">Vercel · {runtime.config.runtime}</p></div>
				<div class="rounded-lg border p-4"><p class="font-medium">Database</p><p class="mt-1 text-sm text-muted-foreground">{runtime.config.databaseProvider}</p></div>
				<div class="rounded-lg border p-4"><p class="font-medium">Object storage</p><p class="mt-1 text-sm text-muted-foreground">{runtime.config.storageProvider}</p></div>
				<div class="rounded-lg border p-4"><p class="font-medium">Workspace filesystem model</p><p class="mt-1 text-sm text-muted-foreground">{runtime.config.filesystemModel}</p></div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2"><ShieldCheck class="size-4" />Engine Host security</CardTitle>
				<CardDescription>Panel-to-Engine-Host attach, detach and control requests are signed server-to-server. The secret itself is never displayed in OrbitFS.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if runtime.config.enginePairingConfigured}
					<div class="flex gap-3 rounded-lg border border-success/30 bg-success/5 p-4"><CheckCircle2 class="mt-0.5 size-5 shrink-0 text-success" /><div><p class="font-medium">Pairing secret configured</p><p class="mt-1 text-sm text-muted-foreground">Panel has an Engine Host signing secret available. Keep the same <code class="font-mono text-xs">ORBITFS_ENGINE_SECRET</code> value on both Vercel projects.</p></div></div>
				{:else}
					<div class="flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4"><AlertTriangle class="mt-0.5 size-5 shrink-0 text-warning" /><div><p class="font-medium">Engine pairing still needs its shared secret</p><p class="mt-1 text-sm text-muted-foreground">Add <code class="font-mono text-xs">ORBITFS_ENGINE_SECRET</code> to both the Panel and Engine Host Vercel projects with the same secure value. This is a deployment secret, so it is configured in Vercel rather than stored in the browser or shown here.</p></div></div>
				{/if}
			</CardContent>
		</Card>
	{/if}

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2"><KeyRound class="size-4" />Master licensing service</CardTitle>
			<CardDescription>OrbitFS uses one master licence authority for Base, MCP, APEX and Studio. The official default is <span class="font-mono">https://orbitfs.vercel.app/api/license/v1</span>.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if licenseLoading}
				<div class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading licence settings…</div>
			{:else}
				<form class="space-y-3" onsubmit={saveLicense}>
					<div class="space-y-1.5"><label for="license-url" class="text-sm font-medium">Licence API base URL</label><Input id="license-url" bind:value={licenseUrl} placeholder="https://orbitfs.vercel.app/api/license/v1" /><p class="text-xs text-muted-foreground">Change this only when deliberately moving the OrbitFS licence authority. Public HTTPS is required.</p></div>
					<div class="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={licenseSaving}>{#if licenseSaving}<LoaderCircle class="size-4 animate-spin" />{:else}<Save class="size-4" />{/if}Save licence service</Button><Button type="button" size="sm" variant="outline" disabled={licenseTesting} onclick={testLicense}>{#if licenseTesting}<LoaderCircle class="size-4 animate-spin" />{:else}<Network class="size-4" />{/if}Test connection</Button></div>
				</form>
				{#if licenseError}<p class="mt-3 text-sm text-destructive">{licenseError}</p>{/if}
				{#if licenseMessage}<p class="mt-3 text-sm text-muted-foreground">{licenseMessage}</p>{/if}
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2"><HardDriveDownload class="size-4" />Google Drive integration</CardTitle>
			<CardDescription>Optional import/upload integration. Unlike Vercel and Supabase infrastructure, this is a normal OrbitFS application setting and is managed here.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if driveLoading}
				<div class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading Google Drive settings…</div>
			{:else}
				<form class="space-y-4" onsubmit={saveDrive}>
					<label class="flex items-start gap-3 rounded-lg border p-3"><input class="mt-1 size-4" type="checkbox" bind:checked={driveEnabled} /><span><span class="block text-sm font-medium">Enable Google Drive</span><span class="block text-xs text-muted-foreground">Allow OrbitFS to use the configured Google OAuth client for Drive integration.</span></span></label>
					<div class="space-y-1.5"><label for="drive-client-id" class="text-sm font-medium">Google OAuth client ID</label><Input id="drive-client-id" bind:value={driveClientId} disabled={!driveEnabled} placeholder="xxxxx.apps.googleusercontent.com" /><p class="text-xs text-muted-foreground">Required only when Google Drive is enabled.</p></div>
					<Button type="submit" size="sm" disabled={driveSaving}>{#if driveSaving}<LoaderCircle class="size-4 animate-spin" />{:else}<Save class="size-4" />{/if}Save Google Drive</Button>
				</form>
				{#if driveError}<p class="mt-3 text-sm text-destructive">{driveError}</p>{/if}
				{#if driveSaved}<p class="mt-3 flex items-center gap-1 text-sm text-success"><CheckCircle2 class="size-4" />Google Drive settings saved.</p>{/if}
			{/if}
		</CardContent>
	</Card>

	<div class="grid gap-3 md:grid-cols-3">
		<a href="/admin/config/install" class="rounded-lg border bg-card p-4 text-sm hover:bg-accent/40"><Cloud class="mb-2 size-5 text-primary" /><div class="flex items-center gap-1 font-medium">Deployment checks <ExternalLink class="size-3" /></div><p class="mt-1 text-muted-foreground">Verify Vercel runtime, licensing and Supabase connectivity.</p></a>
		<a href="/admin/config/paths" class="rounded-lg border bg-card p-4 text-sm hover:bg-accent/40"><Database class="mb-2 size-5 text-primary" /><div class="flex items-center gap-1 font-medium">Storage mapping <ExternalLink class="size-3" /></div><p class="mt-1 text-muted-foreground">See exactly where Library, workspace and system data are stored.</p></a>
		<a href="/admin/config/ports-urls" class="rounded-lg border bg-card p-4 text-sm hover:bg-accent/40"><Globe class="mb-2 size-5 text-primary" /><div class="flex items-center gap-1 font-medium">All endpoints <ExternalLink class="size-3" /></div><p class="mt-1 text-muted-foreground">Panel, API, Engine Host, MCP and licensing addresses in one place.</p></a>
	</div>
</div>
