/**
 * Shared builder for a signal-state map. Keeps preset + default definitions DRY.
 */
export function signals(
	entries: Record<string, Partial<{ enabled: boolean; weight: number }>>
): Record<string, { enabled: boolean; weight: number }> {
	const result: Record<string, { enabled: boolean; weight: number }> = {};
	for (const [id, def] of Object.entries(entries)) {
		result[id] = {
			enabled: def.enabled ?? true,
			weight: clamp01(def.weight ?? 0)
		};
	}
	return result;
}

export function clamp01(value: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
