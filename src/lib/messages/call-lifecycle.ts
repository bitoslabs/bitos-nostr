export type CallLifecycleState =
	| 'idle'
	| 'outgoing'
	| 'incoming'
	| 'connecting'
	| 'connected'
	| 'reconnecting';

export function shouldStartCallTimeout(showCall: boolean, state: CallLifecycleState) {
	return showCall && state !== 'idle' && state !== 'connected' && state !== 'reconnecting';
}

export function shouldStartReconnectTimeout(showCall: boolean, state: CallLifecycleState) {
	return showCall && state === 'reconnecting';
}

export function shouldRemoveGroupPeer(multi: boolean, connectionState: string) {
	return multi && connectionState === 'failed';
}
