# WebSocket Multiplexer

This project implements a WebSocket multiplexer, allowing multiple logical WebSocket connections to be tunneled over a single physical WebSocket connection. This can improve performance and reduce resource consumption in scenarios with many concurrent WebSocket connections.

## Demo

To run the demo:

1.  Clone the repository:

    ```bash
    git clone https://github.com/nero-networks/ws-multiplexer.git
    cd ws-multiplexer
    ```

2.  Run the demo server:

    ```bash
    npm run demo
    ```

3.  Open the demo page in your browser: http://localhost:8081

You can then open the network tab of your browser's developer tools (F12) to observe that only one WebSocket connection is established, even though the demo uses multiple logical WebSocket connections.

## How it Works

The multiplexer works by intercepting WebSocket connections and routing messages based on a channel ID.

*   **Client-side:** The `MultiplexSocket` class creates logical WebSocket connections. It uses a shared `MultiplexerClient` instance to manage the underlying physical WebSocket connection. When a `MultiplexSocket` is created, it sends a "connect" message to the server, requesting a channel ID. All subsequent messages are tagged with this channel ID and sent over the shared WebSocket connection.
*   **Server-side:** The `MultiplexerServer` class handles incoming WebSocket connections and demultiplexes messages based on the channel ID. It maintains a mapping of channel IDs to backend services. When a "connect" message is received, the server assigns a channel ID and forwards the connection to the appropriate backend service.

## Benefits

*   Reduced overhead from establishing and maintaining multiple WebSocket connections.
*   Improved performance in scenarios with many concurrent WebSocket connections.
*   Simplified management of WebSocket connections.
