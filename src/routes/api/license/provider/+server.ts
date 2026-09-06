import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { getLicenseProviderSettings, setLicenseProviderBase, getLicenseProviderDiagnostics } from '$lib/server/license';

async function requireProviderAdmin(cookies: any) {
	const supabase = getSupabaseAdmin();
	const { count, error } = await supabase.from('orbitfs_users').select('*', { count: 'exact', head: true });
	if (error) throw error;
	if ((count ?? 0) === 0) return null;
	return requireAdmin(cookies);
}

export async function GET() {
	try {
		const settings = await getLicenseProviderSettings();
		return json(settings, { headers: { 'cache-control': 'no-store' } });
	} catch (error: any) {
		return json({ error: String(error?.message || 'Could not load licence API settings') }, { status: Number(error?.status || 500) });
	}
}

export async function PUT({ request, cookies }) {
	try {
		await requireProviderAdmin(cookies);
		const body = await request.json().catch(() => ({}));
		return json(await setLicenseProviderBase(String(body.providerBase || '')));
	} catch (error: any) {
		return json({ error: String(error?.message || 'Could not save licence API settings'), code: String(error?.code || 'LICENSE_PROVIDER_INVALID') }, { status: Number(error?.status || 400) });
	}
}
