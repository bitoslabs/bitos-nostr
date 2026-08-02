/**
 * Reaction burst particles — small emoji "confetti" that fly outward from a
 * point and fall with gravity, à la Facebook's live-like celebration. Shared by
 * the story viewer and the feed like button.
 */
export interface Particle {
	id: number;
	emoji: string;
	/** End translate X (px) from the origin. */
	tx: number;
	/** End translate Y (px) from the origin (before gravity drop). */
	ty: number;
	/** End rotation (deg). */
	rot: number;
	/** Animation delay (s) for a staggered feel. */
	delay: number;
	/** Font size (px). */
	size: number;
	/** Animation duration (s). */
	duration: number;
}

const EMOJIS = ['❤️', '💖', '💕', '💗', '💙', '🧡', '💛', '✨', '🔥', '👍'];
let seq = 0;

/**
 * Generate `count` particles radiating outward (biased upward), each with a
 * random emoji, distance, rotation, size and stagger — ready to render.
 */
export function makeParticles(count: number): Particle[] {
	const parts: Particle[] = [];
	for (let i = 0; i < count; i++) {
		// Distribute around the circle with jitter so it never looks mechanical.
		const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.7;
		const dist = 55 + Math.random() * 75;
		parts.push({
			id: ++seq,
			emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
			tx: Math.round(Math.cos(angle) * dist),
			// Bias upward (-20) so hearts lift before gravity pulls them down.
			ty: Math.round(Math.sin(angle) * dist - 20),
			rot: Math.round((Math.random() - 0.5) * 260),
			delay: +(Math.random() * 0.08).toFixed(3),
			size: Math.round(14 + Math.random() * 14),
			duration: +(0.8 + Math.random() * 0.4).toFixed(2)
		});
	}
	return parts;
}
