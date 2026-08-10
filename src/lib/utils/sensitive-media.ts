const sensitivePattern =
	/\b(nsfw|sensitive|content warning|cw:|18\+|adult|nude|nudity|explicit|violence|graphic|gore|blood|self[-\s]?harm)\b/i;

type MediaWarningMetadata = {
	contentWarning?: string;
	sensitive?: string;
	alt?: string;
};

export function sensitiveMediaReason(
	tags: string[][],
	content: string,
	metadata?: MediaWarningMetadata
) {
	const contentWarning = tags.find(
		(tag) => tag[0] === 'content-warning' || tag[0] === 'warning' || tag[0] === 'cw'
	);
	if (contentWarning) return contentWarning[1] || 'Sensitive media';
	if (metadata?.contentWarning) return metadata.contentWarning;
	if (metadata?.sensitive && metadata.sensitive !== 'true') return metadata.sensitive;
	if (metadata?.sensitive === 'true') return 'Sensitive media';
	if (metadata?.alt && sensitivePattern.test(metadata.alt)) return metadata.alt;
	const sensitiveTag = tags.find((tag) => tag[0] === 't' && sensitivePattern.test(tag[1] ?? ''));
	if (sensitiveTag) return `Tagged #${sensitiveTag[1]}`;
	return sensitivePattern.test(content) ? 'Sensitive media' : '';
}
