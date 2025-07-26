import { readFileSync } from 'fs';
import { createServer } from 'http';
import { MultiplexerServer } from '../dist/server.js';

// define some backends
// these can be any function that accepts a WebSocket, a third party WebSocketServer,
// or an EventEmitter (or any other object that implements emit) with a listener for the
// 'connection' event which accepts a WebSocket.
const backends = {
    // The Echo backend simply echoes back any data it receives
    echo: (ws) =>
        ws.onmessage = ({ data }) => ws.send(data),

    // The Uppercase backend converts any data it receives to uppercase
    uppercase: (ws) =>
        ws.onmessage = ({ data }) => ws.send(data.toUpperCase())
};

// 5 Buttons with 5 independent streams
// Each button will create a connection to its own backend which handles messages independently
for (let i = 1; i <= 5; i++) {
    backends[`button${i}`] = (ws) => {
        ws.on('open', () => console.log(`button ${i} open event`));
        ws.onopen = () => console.log(`button ${i} opened`);

        ws.on('message', () => console.log(`button ${i} message event`));
        ws.onmessage = ({ data }) => ws.send(`from button ${i}: Hello ${data}`);

        ws.on('close', () => console.log(`button ${i} close event`));
        ws.onclose = () => console.log(`button ${i} closed`);
    };
}

// This server will serve the HTML page and static files, 
// and delegate WebSocket upgrades to the MultiplexerServer
const server = createServer(({ url }, res) => handleFile(url, res));

// A MultiplexerServer instance with the defined backends
// listening for upgrade events on the server
const muxer = new MultiplexerServer(backends, { noServer: true });
server.on('upgrade', muxer.upgradeHandler());

// Start the server on port 8081
server.listen(8081, () => console.log('multiplexer demo is running on http://localhost:8081'));

// simple function to handle file requests
// it serves the index.html file and static files client.js and socket.js
// if the requested file is not found, it returns a 404 error
function handleFile(url, res) {
    let content = '', contentType = 'text/html';
    const file = (name, type) => { content = readFileSync(name); if (type) contentType = type; };

    if (url === '/') file('./index.html');
    else if (url === '/client.js') file('../dist/client.js', 'application/javascript; charset=utf-8');
    else if (url === '/socket.js') file('../dist/socket.js', 'application/javascript; charset=utf-8');

    res.appendHeader('content-type', contentType + '')
        .writeHead(content ? 200 : 404)
        .end(content || `<h1>404 Not Found</h1>The requested resource '${url}' could not be found.`);
}
