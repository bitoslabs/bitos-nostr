export function canStartNewCall(showCall: boolean, callState: string) {
	return !showCall && callState === 'idle';
}

export function canReceiveNewCall(showCall: boolean, callState: string, sameCall: boolean) {
	return sameCall || (!showCall && callState === 'idle');
}
