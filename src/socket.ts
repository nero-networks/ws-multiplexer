
export type ConnectMessage = {
    type: 'connect';
    ref: string;
    backend: string;
    channel?: never;
};

type Message = { channel: string; };
export type OpenMessage = { type: 'open'; ref: string; } & Message;
export type CloseMessage = { type: 'close'; } & Message & CloseEventInit;
export type DataMessage = { type: 'data'; } & Message & MessageEventInit;
export type MultiplexMessage = ConnectMessage | OpenMessage | CloseMessage | DataMessage;

export type MultiplexerChannels<T extends AbstractMultiplexSocket> = Record<string, T>;

/**
 * Represents a logical WebSocket connection that is multiplexed over a single
 * underlying physical WebSocket connection. It adheres to the WebSocket interface,
 * allowing it to be used as a drop-in replacement for a standard WebSocket.
 */
export abstract class AbstractMultiplexSocket extends EventTarget implements WebSocket {
    CONNECTING = WebSocket.CONNECTING;
    OPEN = WebSocket.OPEN;
    CLOSING = WebSocket.CLOSING;
    CLOSED = WebSocket.CLOSED;

    get binaryType() { return this.socket.binaryType; }
    get bufferedAmount() { return this.socket.bufferedAmount; }
    get extensions() { return this.socket.extensions; }
    get readyState() { return this.socket.readyState; }
    get protocol() { return this.socket.protocol; }

    onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
    onerror: ((this: WebSocket, ev: Event) => any) | null = null;
    onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
    onopen: ((this: WebSocket, ev: Event) => any) | null = null;

    close(code?: number, reason?: string): void {
        // This method is meant to be overridden by the Multiplexer when a channel is added.
        // If it's called before that, it's a programming error.
        throw new Error("This method should be overridden by the Multiplexer.");
    }

    socket!: WebSocket;
    channel!: string;
    url!: string;

    /**
     * Sends data through the multiplexed channel by wrapping it in a MultiplexMessage.
     * The message is JSON-serialized and sent through the underlying WebSocket connection.
     * 
     * @param data - The data to send (string, binary, or blob)
     */
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (!this.channel) return console.error('channel was closed');

        // Wrap the data in a multiplexer message with channel routing information
        this.socket.send(JSON.stringify({ type: 'data', channel: this.channel, data }));
    }

    /**
     * Handles incoming multiplexed messages and dispatches them as appropriate WebSocket events.
     * This is the core message routing logic that converts multiplexer protocol messages
     * back into standard WebSocket events.
     * 
     * @param msg - The multiplexed message to handle
     */
    handleMessage(msg: MultiplexMessage) {

        switch (msg.type) {
            case 'data':
                // Convert multiplexer data message back to standard MessageEvent
                const event = new MessageEvent('message', msg);
                this.dispatchEvent(event);
                if (this.onmessage) this.onmessage(event);
                break;

            case 'close':
                // Propagate close event from multiplexer to this logical socket
                this.close(msg.code, msg.reason);
                break;
        }
    }
}

/**
 * The base class for a multiplexer, which manages multiple logical sockets
 * over a single real WebSocket connection. This class is abstract and should be
 * extended by client-side and server-side implementations.
 */
export abstract class Multiplexer<T extends AbstractMultiplexSocket> {
    channels: MultiplexerChannels<T> = {};

    /**
     * Registers a new multiplexed socket with a specific channel ID.
     * This method overrides the socket's `close` function to ensure that closing
     * the virtual socket notifies the other party and cleans up resources on both ends.
     * The `closed` flag prevents infinite close-message loops.
     * 
     * @param sock - The multiplexed socket to register
     * @param channel - The unique channel identifier for this socket
     */
    addChannel(sock: T, channel: string) {
        sock.channel = channel;

        // This flag prevents a close loop. Once closed, subsequent calls are ignored.
        let closed = false;
        sock.close = (code?: number, reason?: string) => {
            if (closed) return;
            closed = true;

            // Only send a close message if the underlying socket is still open.
            if (sock.socket.readyState === WebSocket.OPEN) {
                sock.socket.send(JSON.stringify({ type: 'close', channel: sock.channel, code, reason }));
            }

            // Dispatch the close event locally to notify listeners.
            this.emit(sock, new CloseEvent('close', { code, reason }), sock.onclose);

            // Remove the channel from the multiplexer.
            delete this.channels[sock.channel];
        };

        this.channels[sock.channel] = sock;
    }

    /**
     * Sets up event handlers on the underlying WebSocket to propagate
     * connection-level events (close, error) to all multiplexed channels.
     * This ensures that when the physical connection fails, all logical
     * connections are properly notified.
     * 
     * @param socket - The underlying WebSocket connection
     */
    wireDefaultEvents(socket: WebSocket) {

        socket.onclose = ({ code, reason }) => {
            // When the underlying connection closes, close all multiplexed channels
            Object.values(this.channels).forEach(sock => sock.close(code, reason));
        };
        socket.onerror = (event) => {
            // Propagate connection errors to all multiplexed channels
            Object.values(this.channels).forEach(sock => this.emit(sock, event, sock.onerror));
        };
    }

    /**
     * Routes incoming messages to the appropriate multiplexed channel.
     * This is the core message demultiplexing logic that takes messages
     * from the single WebSocket and delivers them to the correct logical socket.
     * 
     * @param msg - The multiplexed message containing channel routing info
     */
    handleChannelMessage(msg: MultiplexMessage) {
        if (!msg.channel) return console.error('expected channel message');

        const sock = this.channels[msg.channel];
        if (!sock) return console.error('channel not found' + msg.channel);

        sock.handleMessage(msg);
    }

    /**
     * Helper method to emit events on multiplexed sockets while respecting
     * both the EventTarget interface (dispatchEvent) and the WebSocket
     * callback interface (onmessage, onclose, etc.).
     * 
     * @param sock - The socket to emit the event on
     * @param event - The event to emit
     * @param handler - The callback handler to invoke (if any)
     */
    emit<T extends Event, S extends AbstractMultiplexSocket>(sock: S, event: T, handler?: ((this: S, ev: T) => any) | null) {
        sock.dispatchEvent(event);
        if (handler) handler.call(sock, event);
    }

    randomId() {
        return ((0.00001 + Math.random()).toString(36)).slice(2, 5 + 2);
    }
}
