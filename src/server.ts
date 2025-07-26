import { IncomingMessage } from 'http';
import Stream from 'stream';
import { ServerOptions, WebSocketServer } from 'ws';
import { AbstractMultiplexSocket, ConnectMessage, Multiplexer, type MultiplexMessage } from './socket.js';

export type MultiplexerBackends = {
    [id: string]:
    { emit: (type: 'connection', sock: WebSocket) => void; }
    | ((sock: WebSocket) => void);
};

type Handler = ((msg: string) => void) & { wrapped?: EventListener; };

class MultiplexSocket extends AbstractMultiplexSocket {
    constructor(socket: WebSocket) {
        super();
        this.socket = socket;
        this.url = socket.url;
    }

    on(type: string, callback: Handler) {
        callback.wrapped = this._wrap(callback);
        this.addEventListener(type, callback.wrapped);
    }

    once(type: string, callback: Handler) {
        this.addEventListener(type, this._wrap(callback), { once: true });
    }

    off(type: string, callback: Handler) {
        if (callback.wrapped)
            this.removeEventListener(type, callback.wrapped);
    }

    _wrap(callback: Handler): EventListener {
        return (event: any) => {
            let data = event.data;
            if (event.type === 'error') data = { code: event.code, message: event.reason };
            callback(data);
        };
    }
}

export class MultiplexerServer extends Multiplexer<MultiplexSocket> {
    wss: WebSocketServer;
    backends: MultiplexerBackends;

    constructor(backends: MultiplexerBackends, options: ServerOptions) {
        super();
        this.backends = backends;
        this.wss = new WebSocketServer(options);

        this.wss.on('connection', (socket: WebSocket) => {
            this.wireDefaultEvents(socket);

            socket.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data.toString()) as MultiplexMessage;

                    if (msg.type === 'connect') {
                        this.handleConnectMessage(msg, socket);
                    } else if (msg.channel) {
                        this.handleChannelMessage(msg);
                    } else {
                        console.error('unimplemented MultiplexMessage.type ' + msg.type);
                    }
                } catch (error) {
                    console.error('Failed to parse multiplexer message:', error, 'Raw data:', event.data.toString());
                }
            };
        });
    }

    upgradeHandler() {
        return (req: IncomingMessage, socket: Stream.Duplex, head: Buffer) =>
            this.wss.handleUpgrade(req, socket, head, (ws) =>
                this.wss.emit('connection', ws, req));
    }

    handleConnectMessage(msg: MultiplexMessage, socket: WebSocket) {
        if (msg.type !== 'connect') return console.error('expected connect message');

        const backend = this.getBackend(msg);
        if (!backend) return console.error('backend not found');

        const channel = this.randomId();
        socket.send(JSON.stringify({ type: 'open', channel, ref: msg.ref }));

        const sock = new MultiplexSocket(socket);
        this.addChannel(sock, channel);

        if (typeof backend === 'function') {
            backend(sock);
        }
        if (typeof backend === 'object') {
            backend.emit('connection', sock);
        }
        this.emit(sock, new Event('open'), sock.onopen);
    }

    /**
     * Extracts the backend service identifier from a connection request URL.
     * This parses URLs like 'ws://localhost:8080/chat' to extract 'chat'
     * as the backend service name.
     * 
     * @param msg - The connect message containing the backend URL
     * @returns The backend service object, or undefined if not found
     */
    getBackend(msg: ConnectMessage) {
        // Extract the last path segment as the backend ID
        // e.g., 'ws://localhost:8080/chat' -> 'chat'
        const id = msg.backend.split('/').filter(p => p).pop();
        return id ? this.backends[id] : undefined;
    }
}

