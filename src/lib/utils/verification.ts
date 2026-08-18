export function hasNip05(profile?: { nip05?: string | null } | null): boolean {
	return !!profile?.nip05?.trim();
}
