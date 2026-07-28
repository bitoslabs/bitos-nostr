export type IncomingCallAlert = {
	id: string;
	callId: string;
	kind: 'voice' | 'video';
	from: string;
	groupId?: string;
	callerName: string;
	createdAt: number;
};

class CallAlertsStore {
	items = $state<IncomingCallAlert[]>([]);
	private dismissed = new Set<string>();

	get latest() {
		return this.items[0];
	}

	upsert(alert: IncomingCallAlert) {
		if (this.dismissed.has(alert.id) || this.dismissed.has(alert.callId)) return;
		this.items = [alert, ...this.items.filter((item) => item.id !== alert.id)];
	}

	dismiss(idOrCallId: string) {
		this.dismissed.add(idOrCallId);
		this.items = this.items.filter((item) => item.id !== idOrCallId && item.callId !== idOrCallId);
	}

	closeCall(callId: string) {
		this.dismiss(callId);
	}

	clear() {
		this.items = [];
	}
}

export const callAlerts = new CallAlertsStore();
