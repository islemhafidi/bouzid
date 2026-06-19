const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8090;
const DB_FILE = path.join(__dirname, 'votes.json');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.ico': 'image/x-icon'
};

// In-memory cache for Database to optimize read performance and prevent I/O bottlenecks
let dbCache = { votes: [], count: 1152 };
let writeQueue = Promise.resolve();

// Asynchronous DB initialization
async function initDb() {
    try {
        await fs.promises.access(DB_FILE);
        const data = await fs.promises.readFile(DB_FILE, 'utf8');
        const parsed = JSON.parse(data);
        dbCache = parsed;
        if (typeof dbCache.count !== 'number') {
            dbCache.count = dbCache.votes ? dbCache.votes.length : 1152;
        }
    } catch (err) {
        // File does not exist or is invalid JSON, initialize it
        dbCache = { votes: [], count: 1152 };
        await saveDbAsync();
    }
}

// Queue database writes to prevent race conditions and write corruption
function saveDbAsync() {
    writeQueue = writeQueue.then(async () => {
        try {
            await fs.promises.writeFile(DB_FILE, JSON.stringify(dbCache, null, 2), 'utf8');
        } catch (e) {
            console.error('Failed to write DB file:', e);
        }
    });
    return writeQueue;
}

const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // API: Submit Vote
    if (req.url === '/api/vote' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { name, email } = JSON.parse(body);
                if (!name || !email) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Name and email are required' }));
                }

                // Add to cache (Instant and non-blocking)
                dbCache.votes.push({ name, email, date: new Date().toISOString() });
                dbCache.count = (dbCache.count || 0) + 1;
                
                // Flush to disk asynchronously without blocking the client response
                saveDbAsync();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'نجاح', count: dbCache.count }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            }
        });
        return;
    }

    // API: Fetch Vote Count
    if (req.url === '/api/vote-count' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ count: dbCache.count }));
    }

    // Serve Static Files safely
    if (req.method === 'GET') {
        const PUBLIC_DIR = path.resolve(__dirname);
        
        let safeUrl = req.url;
        const questionMarkIndex = safeUrl.indexOf('?');
        if (questionMarkIndex !== -1) {
            safeUrl = safeUrl.substring(0, questionMarkIndex);
        }

        let resolvedPath = path.join(PUBLIC_DIR, safeUrl);

        // Security: Prevent path traversal
        if (!resolvedPath.startsWith(PUBLIC_DIR)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Access Denied');
        }

        // Security: Block sensitive file downloads
        const baseName = path.basename(resolvedPath);
        const BLOCKED_FILES = ['app.js', 'server.js', 'votes.json', 'package.json', 'package-lock.json', '.git'];
        if (BLOCKED_FILES.includes(baseName) || baseName.startsWith('.')) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Access Denied');
        }

        // Handle directory default to index.html asynchronously
        fs.stat(resolvedPath, (err, stats) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                return res.end('Not Found');
            }

            if (stats.isDirectory()) {
                resolvedPath = path.join(resolvedPath, 'index.html');
            }

            const extname = String(path.extname(resolvedPath)).toLowerCase();
            const contentType = MIME_TYPES[extname] || 'application/octet-stream';

            // Read and serve file asynchronously
            fs.readFile(resolvedPath, (error, content) => {
                if (error) {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not Found');
                } else {
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(content);
                }
            });
        });
        return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
});

// Initialize database then start server
initDb().then(() => {
    server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}/`);
    });
});
