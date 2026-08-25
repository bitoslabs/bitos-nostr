export function hasNip05(profile?: { nip05?: string | null } | null): boolean {
	return !!profile?.nip05?.trim();
}

/**
 * Whether the profile has a Lightning address (lud16 preferred, lud06 as
 * fallback). Drives the ⚡ badge on avatars; NIP-05 verification is shown
 * as a ✓ next to the username instead.
 */
export function hasLightning(
	profile?: { lud16?: string | null; lud06?: string | null } | null
): boolean {
	return !!(profile?.lud16?.trim() || profile?.lud06?.trim());
}
