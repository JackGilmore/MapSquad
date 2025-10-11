/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

type ClientEvent =
	| { type: 'join'; room: string; name: string }
	| { type: 'question'; id: string; text: string }
	| { type: 'answer-pin'; questionId: string; lat: number; lng: number; label?: string }
	| { type: 'list' };

type ServerEvent =
	| { type: 'joined'; room: string; you: string }
	| { type: 'presence'; members: string[] }
	| { type: 'question'; id: string; text: string; author: string; ts: number }
	| { type: 'answer-pin'; questionId: string; lat: number; lng: number; label?: string; author: string; ts: number }
	| { type: 'error'; message: string };

interface RoomState {
	members: Map<string, WebSocket>;
}

// Augment Env to include our bindings
type Bindings = {
	ROOMS: DurableObjectNamespace;
	ASSETS: Fetcher;
};

export class Room implements DurableObject {
	constructor(private state: DurableObjectState, private env: Env) {
		this.state.blockConcurrencyWhile(async () => {
			// No persistent state yet, transient connections only for MVP
		});
	}

	private broadcast(evt: ServerEvent) {
		const msg = JSON.stringify(evt);
		for (const [, ws] of this.getMembers()) {
			try { ws.send(msg); } catch {}
		}
	}

	private getMembers(): IterableIterator<[string, WebSocket]> {
		const sockets = this.state.getWebSockets();
		// Map tags[0] as member name if set; fallback to 'anon'
		const pairs: [string, WebSocket][] = sockets.map((ws) => {
			const tags = this.state.getTags(ws);
			return [tags[0] ?? 'anon', ws];
		});
		return pairs[Symbol.iterator]();
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/ws') {
			const upgrade = request.headers.get('upgrade');
			if (upgrade !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
			const name = url.searchParams.get('name') || 'anon-' + crypto.randomUUID().slice(0, 4);
			const { 0: client, 1: server } = new WebSocketPair();
			this.state.acceptWebSocket(server, [name]);
			const members = Array.from(this.getMembers()).map(([n]) => n);
			server.send(JSON.stringify({ type: 'joined', room: this.state.id.toString(), you: name } satisfies ServerEvent));
			server.send(JSON.stringify({ type: 'presence', members } satisfies ServerEvent));
			return new Response(null, { status: 101, webSocket: client });
		}
		return new Response('Not Found', { status: 404 });
	}

	webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void> {
		const dataStr = typeof message === 'string' ? message : new TextDecoder().decode(message);
		let evt: ClientEvent | undefined;
		try { evt = JSON.parse(dataStr); } catch { return; }
		const tags = this.state.getTags(ws);
		const author = tags[0] ?? 'anon';
		if (!evt) return;
		switch (evt.type) {
			case 'question': {
				const payload: ServerEvent = { type: 'question', id: evt.id, text: evt.text, author, ts: Date.now() };
				this.broadcast(payload);
				break;
			}
			case 'answer-pin': {
				const payload: ServerEvent = { type: 'answer-pin', questionId: evt.questionId, lat: evt.lat, lng: evt.lng, label: evt.label, author, ts: Date.now() };
				this.broadcast(payload);
				break;
			}
			case 'list': {
				const members = Array.from(this.getMembers()).map(([n]) => n);
				ws.send(JSON.stringify({ type: 'presence', members } satisfies ServerEvent));
				break;
			}
			default:
				ws.send(JSON.stringify({ type: 'error', message: 'Unknown event' } satisfies ServerEvent));
		}
	}

	webSocketClose(ws: WebSocket): void | Promise<void> {
		const members = Array.from(this.getMembers()).map(([n]) => n);
		this.broadcast({ type: 'presence', members });
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		// WebSocket entry: /room/:roomId
		const roomMatch = url.pathname.match(/^\/room\/([A-Za-z0-9_-]+)(?:\/ws)?$/);
		if (roomMatch) {
			const roomId = roomMatch[1];
			const id = (env as Env & Bindings).ROOMS.idFromName(roomId);
			const stub = (env as Env & Bindings).ROOMS.get(id);
			// Forward to DO's /ws endpoint preserving query
			const wsUrl = new URL('/ws' + (url.search || ''), 'https://do.local');
			const req = new Request(wsUrl.toString(), request);
			return stub.fetch(req);
		}

		// Helper endpoints
		switch (url.pathname) {
					case '/message':
						// Keep original test green
						return new Response('Hello, World!');
			case '/random':
				return new Response(crypto.randomUUID());
			default:
				break;
		}

		// Serve static assets via binding if available
			if ((env as Partial<Env & Bindings>).ASSETS) {
			try {
					const assets = (env as Env & Bindings).ASSETS;
					return await assets.fetch(request);
			} catch (e) {
				// fallthrough
			}
		}
		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
