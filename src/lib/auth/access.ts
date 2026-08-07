export const STANDALONE_PUBLIC_ROUTES = new Set(['/about', '/privacy', '/terms', '/welcome']);

const PROTECTED_ROUTE_PREFIXES = ['/messages', '/notifications', '/bookmarks', '/settings'];

export function isStandalonePublicRoute(pathname: string) {
	return STANDALONE_PUBLIC_ROUTES.has(pathname);
}

export function isProtectedRoute(pathname: string) {
	if (pathname === '/profile') return true;
	return PROTECTED_ROUTE_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
	);
}

export function authMessageForPath(pathname: string) {
	if (pathname === '/messages') {
		return {
			title: 'Messages need your key',
			description:
				'Create or import an nsec to open chats, start calls, and sync your private conversations.'
		};
	}
	if (pathname === '/notifications') {
		return {
			title: 'Notifications are personal',
			description:
				'Sign in with your Nostr key to see mentions, reactions, reposts, follows, and zaps.'
		};
	}
	if (pathname === '/bookmarks') {
		return {
			title: 'Bookmarks are saved on your device',
			description:
				'Load an identity to manage the notes you saved for later and keep them tied to your active account.'
		};
	}
	if (pathname === '/profile') {
		return {
			title: 'Your profile needs login',
			description:
				'Create or import a key to load your own profile, publish metadata, and manage your public identity.'
		};
	}
	if (pathname === '/settings' || pathname.startsWith('/settings/')) {
		return {
			title: 'Settings need an active identity',
			description:
				'Sign in to manage your profile, security options, media providers, and account-specific preferences.'
		};
	}
	return {
		title: 'This area needs login',
		description:
			'Create or import a key to unlock account-specific actions and private data in BitOS.'
	};
}
