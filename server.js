// Kleiner lokaler Entwicklungsserver für den ReSi-Helfer.
// Liefert nur resi-helper.js aus, nur an diesen PC (127.0.0.1).
// Start:  node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const FILE = path.join(__dirname, 'resi-helper.js');

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/resi-helper.js') {
    res.writeHead(404); return res.end('not found');
  }
  fs.readFile(FILE, 'utf8', (err, code) => {
    if (err) { res.writeHead(500); return res.end('// Fehler: ' + err.message); }
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': 'https://rettungssimulator.online',
    });
    res.end(code);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`ReSi-Helfer-Server läuft: http://127.0.0.1:${PORT}/resi-helper.js`);
});
