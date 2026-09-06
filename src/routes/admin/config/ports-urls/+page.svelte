<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui';
	import { CheckCircle2, LoaderCircle, Plug } from '@lucide/svelte';
	type Field = { key:string; label:string; value:string; description?:string };
	let fields=$state<Field[]>([]), loading=$state(true), error=$state('');
	async function load(){loading=true;error='';try{fields=(await api.get<{fields:Field[]}>('/config/ports-urls')).fields;}catch(e){error=e instanceof ApiError?e.message:'Failed to load OrbitFS endpoints';}finally{loading=false;}}
	load();
</script>

<div class="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
	<div><h1 class="flex items-center gap-2 text-xl font-semibold"><Plug class="size-5" />OrbitFS endpoints</h1><p class="max-w-2xl text-sm text-muted-foreground">The actual cloud addresses used by Panel, Engine Host, MCP clients and master licensing. Vercel owns public routing, so there are no local ports or localhost addresses to manage.</p></div>
	{#if error}<p class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}
	{#if loading}<div class="flex justify-center py-16 text-muted-foreground"><LoaderCircle class="size-5 animate-spin" /></div>
	{:else}
		<Card>
			<CardHeader><CardTitle>Active service addresses</CardTitle><CardDescription>These values define how the OrbitFS cloud components find each other.</CardDescription></CardHeader>
			<CardContent class="grid gap-3 md:grid-cols-2">
				{#each fields as field (field.key)}
					<div class="rounded-lg border bg-background/40 p-4">
						<div class="flex items-center justify-between gap-3"><span class="font-medium">{field.label}</span><span class="flex items-center gap-1 text-xs text-success"><CheckCircle2 class="size-3.5" />Configured</span></div>
						<div class="mt-2 break-all font-mono text-xs">{field.value}</div>
						{#if field.description}<p class="mt-2 text-xs text-muted-foreground">{field.description}</p>{/if}
					</div>
				{/each}
			</CardContent>
		</Card>
		<div class="rounded-lg border bg-muted/20 p-4 text-sm"><p class="font-medium">Where do I change things?</p><p class="mt-1 text-muted-foreground">Application settings such as the licence provider and Google Drive are changed on the main Configuration page. Deployment URLs are controlled by the Vercel projects and OrbitFS environment configuration so the running application cannot accidentally disconnect itself.</p></div>
	{/if}
</div>
