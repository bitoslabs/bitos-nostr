/** Common quick-insert groups shared by the post and reply composers. */
const FACE_EMOJIS = [
	'😀',
	'😂',
	'🤣',
	'😊',
	'😍',
	'🥰',
	'😘',
	'😎',
	'🤔',
	'🥳',
	'😴',
	'🤯',
	'🥺',
	'😭',
	'😢',
	'😡'
] as const;

const GESTURE_EMOJIS = ['👍', '👎', '👏', '🙌', '🙏', '💪', '🫂', '👀'] as const;
const CLOSING_EMOJIS = ['💯', '💩', '🐮'] as const;

/** Post composer keeps its Bitcoin/market shorthand first. */
export const COMPOSER_EMOJIS = [
	'₿',
	'🚀',
	'🌕',
	'⚡',
	'🟠',
	'❤️',
	'🧡',
	'📈',
	'💎',
	...FACE_EMOJIS,
	...GESTURE_EMOJIS,
	...CLOSING_EMOJIS
] as const;

/** Reply composer keeps its conversational reactions at the end. */
export const REPLY_EMOJIS = [
	...FACE_EMOJIS,
	...GESTURE_EMOJIS,
	'❤️',
	'🔥',
	'✨',
	'⚡',
	'🎉',
	...CLOSING_EMOJIS
] as const;
