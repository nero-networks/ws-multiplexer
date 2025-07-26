import { AbstractMultiplexSocket, Multiplexer, MultiplexMessage } from "./socket.js";

const registry: { [id: string]: MultiplexerClient; } = {};

/**
 * Connection pooling function that ensures we reuse WebSocket connections.
 * Multiple MultiplexSocket instances to the same base URL will share a single
 * underlying WebSocket connection, which is the core benefit of multiplexing.
 * 
 * @param url - The base WebSocket URL (without the endpoint path)
 * @param protocols - Optional WebSocket protocols
 * @returns A shared MultiplexerClient instance
 */
function getMuxer(url: string, protocols?: string | string[]) {
    const id = url + (protocols?.toString() || '');
    if (!registry[id]) registry[id] = new MultiplexerClient(url, protocols);
    return registry[id];
}

export class MultiplexSocket extends AbstractMultiplexSocket {
    constructor(url: string, protocols?: string | string[]) {
        super();
        this.url = url;

        const muxer = getMuxer(url.substring(0, url.lastIndexOf('/')), protocols);
        this.socket = muxer.socket;
        muxer.connect(this);
    }
}

class MultiplexerClient extends Multiplexer<MultiplexSocket> {
    socket: WebSocket;
    pending: (() => void)[] | undefined = [];
    url: string;

    constructor(url: string | URL, protocols?: string | string[]) {
        super();
        this.url = url.toString() || '/';
        this.socket = new WebSocket(this.url, protocols);
        this.socket.onopen = () => {
            this.pending?.forEach(pending => pending());
            this.pending = undefined;
        };

        this.wireDefaultEvents(this.socket);

        this.socket.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data) as MultiplexMessage;

                if (msg.type === 'open') {
                    this.handleOpenMessage(msg);
                } else if (msg.channel) {
                    this.handleChannelMessage(msg);
                } else {
                    console.error('unimplemented MultiplexMessage.type ' + msg.type);
                }
            } catch (error) {
                console.error('Failed to parse multiplexer message:', error, 'Raw data:', e.data);
            }
        };
    }

    /**
     * Initiates a new multiplexed connection by sending a connect request to the server.
     * This is the handshake process where we request a new logical channel.
     * 
     * The flow is:
     * 1. Generate a temporary reference ID for this connection attempt
     * 2. Store the socket temporarily under this reference
     * 3. Send connect message to server with the backend URL
     * 4. Server responds with 'open' message containing the real channel ID
     * 5. We remap the socket from temp reference to real channel ID
     * 
     * @param sock - The MultiplexSocket requesting a connection
     */
    connect(sock: MultiplexSocket) {
        const ref = this.randomId();
        // Store socket with temporary reference until server assigns real channel ID
        this.channels[ref] = sock;

        // Set up temporary close handler that cleans up the temporary reference
        sock.close = () => delete this.channels[ref];

        const msg: MultiplexMessage = { type: 'connect', ref, backend: sock.url };
        const json = JSON.stringify(msg);

        // if pending is undefied the open handler ran and it is safe to send
        if (!this.pending) this.socket.send(json);
        // if not postpone the send until the open handler was running
        else this.pending.push(() => this.socket.send(json));
    }

    handleOpenMessage(msg: MultiplexMessage) {
        if (msg.type !== 'open') return console.error('expected open message');

        // Remap socket from temporary reference to permanent channel ID
        const sock = this.channels[msg.channel] = this.channels[msg.ref];
        delete this.channels[msg.ref];

        // Complete the channel setup and notify the socket it's connected
        this.addChannel(sock, msg.channel);
        this.emit(sock, new Event('open'), sock.onopen);
    }
}
