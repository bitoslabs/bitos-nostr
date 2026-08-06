const sensitivePattern =
	/\b(nsfw|sensitive|content warning|cw:|18\+|adult|nude|nudity|explicit|violence|graphic|gore|blood|self[-\s]?harm)\b/i;

export function sensitiveMediaReason(tags: string[][], content: string) {
	const contentWarning = tags.find((tag) => tag[0] === 'content-warning' || tag[0] === 'warning');
	if (contentWarning) return contentWarning[1] || 'Sensitive media';
	const sensitiveTag = tags.find((tag) => tag[0] === 't' && sensitivePattern.test(tag[1] ?? ''));
	if (sensitiveTag) return `Tagged #${sensitiveTag[1]}`;
	return sensitivePattern.test(content) ? 'Sensitive media' : '';
}
