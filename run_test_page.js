// Simple HTTP server to run the test page
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.txt': 'text/plain'
};

const server = http.createServer((req, res) => {
    console.log(`Request: ${req.url}`);
    
    // Default to index.html if root path
    let filePath = req.url === '/' 
        ? './sweep_test.html' 
        : '.' + req.url;
    
    // Get file extension
    const extname = path.extname(filePath);
    let contentType = MIME_TYPES[extname] || 'application/octet-stream';
    
    // Read file
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // File not found
                console.log(`File not found: ${filePath}`);
                res.writeHead(404);
                res.end('File not found');
            } else {
                // Server error
                console.error(`Server error: ${err.code}`);
                res.writeHead(500);
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            // Success - return content
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Opening test page in browser...`);
    
    // Try to open in browser if on a supported platform
    const startCommand = process.platform === 'win32' ? 'start' :
                        process.platform === 'darwin' ? 'open' : 
                        process.platform === 'linux' ? 'xdg-open' : null;
    
    if (startCommand) {
        require('child_process').exec(`${startCommand} http://localhost:${PORT}/`);
    }
});

console.log("Press Ctrl+C to stop the server"); 