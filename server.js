const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('express-basic-auth');
const rateLimit = require('express-rate-limit');
const session = require('express-session');

const app = express();
const HTTP_PORT = 3000;
const HTTPS_PORT = 3443;

// Change this to your media root folder path
const MEDIA_ROOT = '/Volumes/VAMSHI/VAMSHI/';
const SUPPORTED_FORMATS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];

// SSL Certificate paths
const SSL_KEY = path.join(__dirname, 'certs', 'server.key');
const SSL_CERT = path.join(__dirname, 'certs', 'server.crt');

// Tags database (in production, use a real database)
const TAGS_FILE = path.join(__dirname, 'tags.json');
let movieTags = {};

// Load tags from file
function loadTags() {
    try {
        if (fs.existsSync(TAGS_FILE)) {
            movieTags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading tags:', error);
        movieTags = {};
    }
}

// Save tags to file
function saveTags() {
    try {
        fs.writeFileSync(TAGS_FILE, JSON.stringify(movieTags, null, 2));
    } catch (error) {
        console.error('Error saving tags:', error);
    }
}

// Initialize tags
loadTags();

// Session configuration
app.use(session({
    secret: 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'mediaserver.sid',
    cookie: { 
        secure: false, // Set to true in production with HTTPS
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
}));

// Security middleware
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

const basicAuth = auth({
    users: { 
        'vamshi': 'abe124',
        'family': 'another-password'
    },
    challenge: true,
    realm: 'Advanced Media Server',
    unauthorizedResponse: (req) => {
        return 'Access denied. Please enter valid credentials.';
    }
});

app.use(express.json());
// app.use(limiter);
app.use(basicAuth);

// Enhanced path sanitization and encoding functions
function sanitizePath(inputPath) {
    if (!inputPath) return '';
    
    // Remove any path traversal attempts but preserve legitimate characters
    const sanitized = inputPath.replace(/\.\./g, '').replace(/\/+/g, '/');
    return sanitized.startsWith('/') ? sanitized.substring(1) : sanitized;
}

// New function to safely encode file paths for URLs
function safeEncodeFilePath(filePath) {
    // Split path into segments and encode each segment separately
    return filePath.split('/').map(segment => {
        // Use encodeURIComponent but handle special cases
        return encodeURIComponent(segment)
            .replace(/'/g, '%27')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29')
            .replace(/\[/g, '%5B')
            .replace(/\]/g, '%5D')
            .replace(/!/g, '%21')
            .replace(/\*/g, '%2A');
    }).join('/');
}

// Enhanced decode function for stream endpoint
function safeDecodeFilePath(encodedPath) {
    try {
        // First decode normally
        let decoded = decodeURIComponent(encodedPath);
        
        // Handle any remaining encoded characters that might cause issues
        decoded = decoded
            .replace(/%5B/gi, '[')
            .replace(/%5D/gi, ']')
            .replace(/%28/gi, '(')
            .replace(/%29/gi, ')')
            .replace(/%21/gi, '!')
            .replace(/%2A/gi, '*')
            .replace(/%27/gi, "'");
            
        return decoded;
    } catch (error) {
        console.error('Error decoding path:', encodedPath, error);
        // Fallback to basic decoding
        return encodedPath.replace(/%20/g, ' ');
    }
}

function validateDirectoryPath(relativePath) {
    const sanitizedPath = sanitizePath(relativePath);
    const fullPath = path.resolve(path.join(MEDIA_ROOT, sanitizedPath));
    const rootPath = path.resolve(MEDIA_ROOT);
    
    if (!fullPath.startsWith(rootPath)) {
        throw new Error('Access denied: Path outside of media root');
    }
    
    return fullPath;
}

function validateFilePath(relativePath) {
    return validateDirectoryPath(relativePath);
}

// Get directory contents (both folders and media files) - FIXED VERSION
function getDirectoryContents(relativePath = '') {
    try {
        const fullPath = validateDirectoryPath(relativePath);
        
        if (!fs.existsSync(fullPath)) {
            console.error('Directory does not exist:', fullPath);
            return { folders: [], files: [], currentPath: relativePath };
        }

        if (!fs.statSync(fullPath).isDirectory()) {
            throw new Error('Path is not a directory');
        }
        
        const items = fs.readdirSync(fullPath);
        const folders = [];
        const files = [];
        
        items.forEach(item => {
            try {
                const itemPath = path.join(fullPath, item);
                const stats = fs.statSync(itemPath);
                // Changed variable name from relativePath to itemRelativePath to avoid shadowing
                const itemRelativePath = path.join(relativePath, item).replace(/\\/g, '/');
                
                if (stats.isDirectory()) {
                    // Count media files in subdirectory
                    let mediaCount = 0;
                    try {
                        const subItems = fs.readdirSync(itemPath);
                        mediaCount = subItems.filter(subItem => {
                            const subItemPath = path.join(itemPath, subItem);
                            try {
                                const subStats = fs.statSync(subItemPath);
                                return subStats.isFile() && SUPPORTED_FORMATS.includes(path.extname(subItem).toLowerCase());
                            } catch {
                                return false;
                            }
                        }).length;
                    } catch {
                        mediaCount = 0;
                    }
                    
                    folders.push({
                        name: item,
                        path: itemRelativePath,
                        type: 'folder',
                        modified: stats.mtime,
                        mediaCount: mediaCount
                    });
                } else if (SUPPORTED_FORMATS.includes(path.extname(item).toLowerCase())) {
                    const extension = path.extname(item).toLowerCase();
                    const nameWithoutExt = path.basename(item, extension);
                    const fullRelativePath = path.join(relativePath, item).replace(/\\/g, '/');
                    
                    files.push({
                        name: item,
                        displayName: nameWithoutExt,
                        path: fullRelativePath,
                        type: 'file',
                        size: stats.size,
                        sizeFormatted: `${(stats.size / 1024 / 1024 / 1024).toFixed(1)} GB`,
                        modified: stats.mtime,
                        created: stats.birthtime,
                        extension: extension,
                        tags: movieTags[fullRelativePath] || [],
                        watched: (movieTags[fullRelativePath] || []).includes('watched')
                    });
                }
            } catch (error) {
                console.error(`Error reading item ${item}:`, error);
            }
        });
        
        // Sort folders first, then files, both alphabetically
        folders.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));
        
        return {
            folders,
            files,
            currentPath: relativePath
        };
    } catch (error) {
        console.error('Error reading directory:', error);
        return { folders: [], files: [], currentPath: relativePath };
    }
}

// Generate breadcrumb navigation
function generateBreadcrumbs(currentPath) {
    const breadcrumbs = [{ name: 'Home', path: '' }];
    
    if (currentPath && currentPath !== '') {
        const pathParts = currentPath.split('/').filter(part => part !== '');
        let accumulatedPath = '';
        
        pathParts.forEach(part => {
            accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
            breadcrumbs.push({
                name: part,
                path: accumulatedPath
            });
        });
    }
    
    return breadcrumbs;
}

// Get all available tags
function getAllTags() {
    const tags = new Set();
    Object.values(movieTags).forEach(movieTagList => {
        if (Array.isArray(movieTagList)) {
            movieTagList.forEach(tag => tags.add(tag));
        }
    });
    return Array.from(tags).sort();
}

// Main page with file system browser
app.get('/', (req, res) => {
    const currentPath = req.query.path || '';
    const contents = getDirectoryContents(currentPath);
    const breadcrumbs = generateBreadcrumbs(currentPath);
    const allTags = getAllTags();
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>📁 File System Media Server</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { box-sizing: border-box; }
            
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; 
                margin: 0; 
                padding: 20px; 
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); 
                color: white; 
                min-height: 100vh;
            }

            .header {
                text-align: center;
                margin-bottom: 30px;
                padding: 20px;
                background: rgba(255,255,255,0.1);
                border-radius: 12px;
                backdrop-filter: blur(10px);
            }

            .breadcrumbs {
                background: rgba(255,255,255,0.05);
                padding: 15px;
                border-radius: 8px;
                margin-bottom: 20px;
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }

            .breadcrumb {
                color: #4CAF50;
                text-decoration: none;
                padding: 5px 10px;
                border-radius: 4px;
                transition: background 0.2s;
            }

            .breadcrumb:hover {
                background: rgba(76, 175, 80, 0.2);
            }

            .breadcrumb.current {
                color: #888;
                pointer-events: none;
            }

            .breadcrumb-separator {
                color: #666;
            }

            .controls {
                background: rgba(255,255,255,0.05);
                padding: 20px;
                border-radius: 12px;
                margin-bottom: 20px;
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 15px;
                align-items: center;
            }

            .search-box, .sort-select, .filter-select {
                padding: 12px;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 8px;
                background: rgba(255,255,255,0.1);
                color: white;
                font-size: 14px;
            }

            .search-box::placeholder { color: rgba(255,255,255,0.6); }

            .view-toggles {
                display: flex;
                gap: 10px;
                justify-content: center;
            }

            .view-btn {
                padding: 8px 16px;
                border: 1px solid #4CAF50;
                background: transparent;
                color: #4CAF50;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s;
            }

            .view-btn.active {
                background: #4CAF50;
                color: white;
            }

            .stats {
                text-align: center;
                color: #888;
                margin-bottom: 20px;
            }

            /* Grid View */
            .content-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 20px;
            }

            /* List View */
            .content-list .item {
                display: flex;
                align-items: center;
                gap: 20px;
                padding: 15px;
                margin-bottom: 15px;
            }

            .content-list .item-content {
                flex: 1;
                min-width: 0;
            }

            .content-list video {
                width: 150px;
                height: 85px;
                object-fit: cover;
            }

            /* Item styles */
            .item {
                background: rgba(51,51,51,0.8);
                border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.1);
                transition: transform 0.2s ease, box-shadow 0.2s ease;
                position: relative;
                overflow: hidden;
                cursor: pointer;
            }

            .item:hover {
                transform: translateY(-4px);
                box-shadow: 0 8px 25px rgba(0,0,0,0.3);
            }

            .item.folder {
                border-left: 4px solid #FF9800;
            }

            .item.file {
                border-left: 4px solid #4CAF50;
            }

            .item-header {
                padding: 15px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }

            .item-title {
                margin: 0 0 8px 0;
                color: #4CAF50;
                font-size: 1.1em;
                font-weight: 600;
                word-break: break-word;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .item.folder .item-title {
                color: #FF9800;
            }

            .item-icon {
                font-size: 1.2em;
            }

            .item-info {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.85em;
                color: #888;
                margin-bottom: 10px;
            }

            .item-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                margin-top: 10px;
            }

            .tag {
                background: #4CAF50;
                color: white;
                padding: 3px 8px;
                border-radius: 12px;
                font-size: 0.75em;
                cursor: pointer;
            }

            .tag.watched { background: #2196F3; }
            .tag.favorite { background: #FF5722; }
            .tag.series { background: #9C27B0; }
            .tag.movie { background: #FF9800; }

            .item-content {
                padding: 15px;
            }

            .folder-info {
                color: #888;
                font-size: 0.9em;
                text-align: center;
                padding: 20px;
            }

            video {
                width: 100%;
                max-height: 200px;
                border-radius: 8px;
                background: #000;
                margin-bottom: 15px;
            }

            .item-actions {
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
                margin-top: 15px;
            }

            .btn {
                padding: 8px 12px;
                border: 1px solid #4CAF50;
                background: transparent;
                color: #4CAF50;
                border-radius: 6px;
                text-decoration: none;
                font-size: 0.85em;
                cursor: pointer;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
                gap: 5px;
            }

            .btn:hover {
                background: #4CAF50;
                color: white;
            }

            .btn-secondary {
                border-color: #666;
                color: #666;
            }

            .btn-secondary:hover {
                background: #666;
                color: white;
            }

            .tag-editor {
                margin-top: 10px;
                display: none;
            }

            .tag-editor.active {
                display: block;
            }

            .tag-input {
                padding: 8px;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 6px;
                background: rgba(255,255,255,0.1);
                color: white;
                width: 100%;
                margin-bottom: 10px;
            }

            .quick-tags {
                display: flex;
                gap: 5px;
                flex-wrap: wrap;
                margin-bottom: 10px;
            }

            .quick-tag {
                padding: 4px 8px;
                border: 1px solid #666;
                background: transparent;
                color: #666;
                border-radius: 12px;
                font-size: 0.75em;
                cursor: pointer;
            }

            .quick-tag:hover {
                background: #666;
                color: white;
            }

            .hidden { display: none !important; }

            .no-results {
                text-align: center;
                padding: 40px;
                color: #888;
                grid-column: 1 / -1;
            }

            .empty-folder {
                text-align: center;
                padding: 60px 20px;
                color: #888;
                background: rgba(255,255,255,0.05);
                border-radius: 12px;
                margin: 20px 0;
            }

            .debug-info {
                font-size: 0.8em;
                color: #666;
                margin-bottom: 10px;
                padding: 8px;
                background: rgba(255,255,255,0.05);
                border-radius: 4px;
                font-family: monospace;
            }

            .error-message {
                padding: 15px;
                background: rgba(244, 67, 54, 0.2);
                border: 1px solid #f44336;
                border-radius: 8px;
                margin: 10px 0;
                color: #f44336;
            }

            @media (max-width: 768px) {
                body { padding: 10px; }
                .controls {
                    grid-template-columns: 1fr;
                    gap: 10px;
                }
                .content-grid {
                    grid-template-columns: 1fr;
                }
                .content-list .item {
                    flex-direction: column;
                    align-items: flex-start;
                }
                .content-list video {
                    width: 100%;
                    height: auto;
                }
                .breadcrumbs {
                    font-size: 0.9em;
                }
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📁 File System Media Server</h1>
            <div>User: ${req.auth.user} • ${contents.folders.length} folders • ${contents.files.length} files</div>
            <div style="margin-top: 8px; padding: 8px; border-radius: 6px; background: ${isSecure ? 'rgba(76, 175, 80, 0.2)' : 'rgba(244, 67, 54, 0.2)'}; border: 1px solid ${isSecure ? '#4CAF50' : '#f44336'};">
                ${isSecure ? '🔒 Secure HTTPS Connection' : '⚠️ UNENCRYPTED HTTP - Your data is visible to others!'}
            </div>
        </div>

        <nav class="breadcrumbs">
            ${breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return `
                    ${index > 0 ? '<span class="breadcrumb-separator">›</span>' : ''}
                    <a href="/?path=${encodeURIComponent(crumb.path)}" class="breadcrumb ${isLast ? 'current' : ''}">
                        ${index === 0 ? '🏠' : '📁'} ${crumb.name}
                    </a>
                `;
            }).join('')}
        </nav>

        <div class="controls">
            <input type="text" class="search-box" placeholder="🔍 Search files and folders..." id="searchBox">
            
            <select class="sort-select" id="sortSelect">
                <option value="name-asc">🔤 Name A-Z</option>
                <option value="name-desc">🔤 Name Z-A</option>
                <option value="modified-desc">📅 Newest First</option>
                <option value="modified-asc">📅 Oldest First</option>
                <option value="size-desc">📦 Largest First</option>
                <option value="size-asc">📦 Smallest First</option>
            </select>

            <select class="filter-select" id="filterSelect">
                <option value="">📋 All Items</option>
                <option value="folders">📁 Folders Only</option>
                <option value="files">📄 Files Only</option>
                <option value="watched">👀 Watched</option>
                <option value="unwatched">🆕 Unwatched</option>
                ${allTags.map(tag => `<option value="${tag}">🏷️ ${tag}</option>`).join('')}
            </select>

            <div class="view-toggles">
                <button class="view-btn active" data-view="grid">🔲 Grid</button>
                <button class="view-btn" data-view="list">📋 List</button>
            </div>
        </div>

        <div class="stats" id="statsDisplay">
            Showing ${contents.folders.length} folders and ${contents.files.length} files
        </div>

        <div class="content-container" id="contentContainer">
            ${contents.folders.length === 0 && contents.files.length === 0 ? `
                <div class="empty-folder">
                    <h3>📂 Empty Folder</h3>
                    <p>This directory contains no media files or subdirectories.</p>
                </div>
            ` : `
                <div class="content-grid" id="contentGrid">
                    ${contents.folders.map(folder => `
                        <div class="item folder" data-name="${folder.name.toLowerCase()}" data-type="folder" data-modified="${new Date(folder.modified).getTime()}" onclick="navigateToFolder('${folder.path}')">
                            <div class="item-header">
                                <h3 class="item-title">
                                    <span class="item-icon">📁</span>
                                    ${folder.name}
                                </h3>
                                <div class="item-info">
                                    <span>${folder.mediaCount} media files</span>
                                    <span>${new Date(folder.modified).toLocaleDateString()}</span>
                                </div>
                            </div>
                            <div class="item-content">
                                <div class="folder-info">
                                    <p>📂 Click to browse this folder</p>
                                    <p>${folder.mediaCount} media files inside</p>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                    
                    ${contents.files.map(file => {
                        const safeId = file.path.replace(/[^a-zA-Z0-9]/g, '');
                        const safePath = file.path.replace(/'/g, "\\'");
                        
                        // Use the new safe encoding function for URLs
                        const encodedPath = file.path.split('/').map(segment => 
                            encodeURIComponent(segment)
                                .replace(/'/g, '%27')
                                .replace(/\(/g, '%28')
                                .replace(/\)/g, '%29')
                                .replace(/\[/g, '%5B')
                                .replace(/\]/g, '%5D')
                                .replace(/!/g, '%21')
                                .replace(/\*/g, '%2A')
                        ).join('/');
                        
                        return `
                        <div class="item file" data-name="${file.displayName.toLowerCase()}" data-type="file" data-tags="${file.tags.join(',')}" data-size="${file.size}" data-modified="${new Date(file.modified).getTime()}">
                            <div class="item-header">
                                <h3 class="item-title">
                                    <span class="item-icon">🎬</span>
                                    ${file.displayName}
                                </h3>
                                <div class="item-info">
                                    <span class="size">${file.sizeFormatted}</span>
                                    <span class="date">${new Date(file.modified).toLocaleDateString()}</span>
                                </div>
                                <div class="item-tags">
                                    ${file.tags.map(tag => `<span class="tag ${tag}">${tag}</span>`).join('')}
                                </div>
                            </div>
                            
                            <div class="item-content">
                                <video controls preload="metadata" 
                                       onloadstart="console.log('Video load started for:', '${safePath}')"
                                       oncanplay="console.log('Video can play:', '${safePath}')"
                                       onerror="handleVideoError(event, '${safePath}')"
                                       onloadedmetadata="console.log('Video metadata loaded for:', '${safePath}')"
                                       onloadeddata="console.log('Video data loaded for:', '${safePath}')">
                                    
                                    <source src="/stream/${encodedPath}" type="video/mp4">
                                    <source src="/stream/${encodedPath}" type="video/webm">
                                    <source src="/stream/${encodedPath}" type="video/x-matroska">
                                    
                                    <div style="padding: 20px; text-align: center; background: #333; border-radius: 8px; color: white;">
                                        <p>Your browser doesn't support video streaming.</p>
                                        <p>File: ${file.name}</p>
                                        <a href="/download/${encodedPath}" style="color: #4CAF50;">⬇️ Download Instead</a>
                                    </div>
                                </video>
                                
                                <!-- Debug info -->
                                <div class="debug-info">
                                    <div><strong>File:</strong> ${file.name}</div>
                                    <div><strong>Path:</strong> ${file.path}</div>
                                    <div><strong>Encoded:</strong> ${encodedPath}</div>
                                    <div><strong>Size:</strong> ${file.sizeFormatted}</div>
                                    <div><strong>Extension:</strong> ${file.extension}</div>
                                    <div><strong>Stream URL:</strong> <a href="/stream/${encodedPath}" target="_blank" style="color: #4CAF50;">/stream/${encodedPath}</a></div>
                                </div>
                                
                                <div class="item-actions">
                                    <a href="/download/${encodedPath}" class="btn">⬇️ Download</a>
                                    <button class="btn btn-secondary" onclick="testVideoStream('${encodedPath}')">🔧 Test Stream</button>
                                    <button class="btn btn-secondary" onclick="toggleWatched('${safePath}')">
                                        ${file.watched ? '👁️ Watched' : '👀 Mark Watched'}
                                    </button>
                                    <button class="btn btn-secondary" onclick="toggleTagEditor('${safeId}')">🏷️ Tags</button>
                                    <a href="/info/${encodedPath}" class="btn btn-secondary">ℹ️ Info</a>
                                </div>

                                <div class="tag-editor" id="tagEditor-${safeId}">
                                    <div class="quick-tags">
                                        <button class="quick-tag" onclick="addQuickTag('${safePath}', 'favorite')">⭐ Favorite</button>
                                        <button class="quick-tag" onclick="addQuickTag('${safePath}', 'series')">📺 Series</button>
                                        <button class="quick-tag" onclick="addQuickTag('${safePath}', 'movie')">🎬 Movie</button>
                                        <button class="quick-tag" onclick="addQuickTag('${safePath}', 'action')">💥 Action</button>
                                        <button class="quick-tag" onclick="addQuickTag('${safePath}', 'comedy')">😂 Comedy</button>
                                    </div>
                                    <input type="text" class="tag-input" placeholder="Add custom tag..." 
                                           onkeypress="if(event.key==='Enter') addCustomTag('${safePath}', this.value)">
                                </div>
                            </div>
                        </div>
                    `}).join('')}
                </div>
            `}
        </div>

        <script>
            let allFolders = ${JSON.stringify(contents.folders)};
            let allFiles = ${JSON.stringify(contents.files)};
            let filteredItems = [...allFolders, ...allFiles];

            // Navigation
            function navigateToFolder(folderPath) {
                window.location.href = '/?path=' + encodeURIComponent(folderPath);
            }

            // Search and filter functionality
            document.getElementById('searchBox').addEventListener('input', filterContent);
            document.getElementById('sortSelect').addEventListener('change', filterContent);
            document.getElementById('filterSelect').addEventListener('change', filterContent);

            // View toggle functionality
            document.querySelectorAll('.view-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    const view = btn.dataset.view;
                    const container = document.getElementById('contentGrid');
                    
                    if (view === 'list') {
                        container.className = 'content-list';
                    } else {
                        container.className = 'content-grid';
                    }
                });
            });

            function filterContent() {
                const searchTerm = document.getElementById('searchBox').value.toLowerCase();
                const sortBy = document.getElementById('sortSelect').value;
                const filterBy = document.getElementById('filterSelect').value;

                // Combine folders and files for filtering
                let allItems = [...allFolders.map(f => ({...f, type: 'folder'})), ...allFiles.map(f => ({...f, type: 'file'}))];

                // Filter items
                filteredItems = allItems.filter(item => {
                    const matchesSearch = item.name.toLowerCase().includes(searchTerm) || 
                                        (item.displayName && item.displayName.toLowerCase().includes(searchTerm)) ||
                                        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(searchTerm)));
                    
                    let matchesFilter = true;
                    if (filterBy === 'folders') {
                        matchesFilter = item.type === 'folder';
                    } else if (filterBy === 'files') {
                        matchesFilter = item.type === 'file';
                    } else if (filterBy === 'watched') {
                        matchesFilter = item.watched === true;
                    } else if (filterBy === 'unwatched') {
                        matchesFilter = item.type === 'file' && !item.watched;
                    } else if (filterBy && filterBy !== '') {
                        matchesFilter = item.tags && item.tags.includes(filterBy);
                    }

                    return matchesSearch && matchesFilter;
                });

                // Sort items
                filteredItems.sort((a, b) => {
                    const [field, order] = sortBy.split('-');
                    let comparison = 0;

                    // Folders first, then files (unless sorting by type-specific fields)
                    if (field !== 'size' && a.type !== b.type) {
                        return a.type === 'folder' ? -1 : 1;
                    }

                    switch (field) {
                        case 'name':
                            const nameA = a.displayName || a.name;
                            const nameB = b.displayName || b.name;
                            comparison = nameA.localeCompare(nameB);
                            break;
                        case 'size':
                            comparison = (a.size || 0) - (b.size || 0);
                            break;
                        case 'modified':
                            comparison = new Date(a.modified) - new Date(b.modified);
                            break;
                    }

                    return order === 'desc' ? -comparison : comparison;
                });

                renderContent();
                updateStats();
            }

            function renderContent() {
                const container = document.getElementById('contentGrid');
                
                if (filteredItems.length === 0) {
                    container.innerHTML = '<div class="no-results">No items found matching your criteria</div>';
                    return;
                }

                // Hide all items first
                document.querySelectorAll('.item').forEach(item => {
                    item.classList.add('hidden');
                });

                // Show filtered items
                filteredItems.forEach(item => {
                    const itemName = (item.displayName || item.name).toLowerCase();
                    const itemElement = document.querySelector('[data-name="' + itemName + '"][data-type="' + item.type + '"]');
                    if (itemElement) {
                        itemElement.classList.remove('hidden');
                    }
                });
            }

            function updateStats() {
                const folders = filteredItems.filter(item => item.type === 'folder').length;
                const files = filteredItems.filter(item => item.type === 'file').length;
                const watched = filteredItems.filter(item => item.watched).length;
                const totalSize = filteredItems.reduce((sum, item) => sum + (item.size || 0), 0);
                const sizeGB = (totalSize / 1024 / 1024 / 1024).toFixed(1);

                let statsText = 'Showing ' + folders + ' folders and ' + files + ' files';
                if (watched > 0) {
                    statsText += ' • ' + watched + ' watched';
                }
                if (totalSize > 0) {
                    statsText += ' • ' + sizeGB + ' GB total';
                }

                document.getElementById('statsDisplay').textContent = statsText;
            }

            function toggleWatched(filePath) {
                fetch('/api/toggle-watched', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        location.reload();
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    alert('Failed to update watched status');
                });
            }

            function toggleTagEditor(safeId) {
                const editor = document.getElementById('tagEditor-' + safeId);
                if (editor) {
                    editor.classList.toggle('active');
                }
            }

            function addQuickTag(filePath, tag) {
                addTag(filePath, tag);
            }

            function addCustomTag(filePath, tag) {
                if (tag && tag.trim()) {
                    addTag(filePath, tag.trim());
                    // Clear input
                    const input = event.target;
                    if (input) {
                        input.value = '';
                    }
                }
            }

            function addTag(filePath, tag) {
                fetch('/api/add-tag', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filePath, tag })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        location.reload();
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    alert('Failed to add tag');
                });
            }

            // Enhanced video debugging functions
            function handleVideoError(event, filePath) {
                console.error('Video error for:', filePath);
                console.error('Error event:', event);
                
                const video = event.target;
                const error = video.error;
                
                if (error) {
                    let errorMessage = 'Unknown video error';
                    let suggestion = '';
                    
                    switch (error.code) {
                        case 1:
                            errorMessage = 'Video loading was aborted';
                            suggestion = 'Try refreshing the page or check your network connection.';
                            break;
                        case 2:
                            errorMessage = 'Network error while loading video';
                            suggestion = 'Check your internet connection and try again.';
                            break;
                        case 3:
                            errorMessage = 'Video format not supported or file is corrupted';
                            suggestion = 'Try downloading the file or convert it to MP4 format.';
                            break;
                        case 4:
                            errorMessage = 'Video source not found or server error';
                            suggestion = 'The file might be missing or the server is having issues.';
                            break;
                    }
                    
                    console.error('Video error details:', {
                        code: error.code,
                        message: errorMessage,
                        filePath: filePath,
                        videoSrc: video.currentSrc || video.src
                    });
                    
                    // Create and show error message
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'error-message';
                   
                    
                    // Insert error message after the video
                    video.parentNode.insertBefore(errorDiv, video.nextSibling);
                }
            }

            function testVideoStream(encodedPath) {
                const streamUrl = '/stream/' + encodedPath;
                console.log('Testing stream URL:', streamUrl);
                
                // Test with HEAD request first
                fetch(streamUrl, { method: 'HEAD' })
                    .then(response => {
                        console.log('Stream test response:', {
                            status: response.status,
                            statusText: response.statusText,
                            headers: Object.fromEntries(response.headers.entries())
                        });
                        
                        if (response.ok) {
                            const contentType = response.headers.get('content-type');
                            const contentLength = response.headers.get('content-length');
                            const acceptRanges = response.headers.get('accept-ranges');
                            
                           
                        } else {
                            
                        }
                    })
                    .catch(error => {
                        console.error('Stream test error:', error);
                        
                    });
            }

            function retryVideo(filePath) {
                // Find the video element and reload it
                const videos = document.querySelectorAll('video');
                videos.forEach(video => {
                    const sources = video.querySelectorAll('source');
                    sources.forEach(source => {
                        if (source.src.includes(encodeURIComponent(filePath))) {
                            console.log('Retrying video:', filePath);
                            // Remove any error messages
                            const errorMessages = video.parentNode.querySelectorAll('.error-message');
                            errorMessages.forEach(msg => msg.remove());
                            video.load(); // Reload the video
                            return;
                        }
                    });
                });
            }

            // Add debugging for all video events
            document.addEventListener('DOMContentLoaded', function() {
                const videos = document.querySelectorAll('video');
                videos.forEach(video => {
                    video.addEventListener('progress', function() {
                        if (video.buffered.length > 0) {
                            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                            const duration = video.duration;
                            
                        }
                    });
                    
                    video.addEventListener('waiting', function() {
                        console.log('Video is waiting for more data...');
                    });
                    
                    video.addEventListener('playing', function() {
                        console.log('Video started playing successfully');
                    });
                });
            });

            // Initialize
            filterContent();
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destruction error:', err);
        }
        res.clearCookie('mediaserver.sid');
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Logged Out</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; 
                        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); 
                        color: white; 
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                        margin: 0;
                    }
                    .logout-box {
                        background: rgba(255,255,255,0.1);
                        padding: 40px;
                        border-radius: 12px;
                        text-align: center;
                        max-width: 400px;
                    }
                    .btn {
                        display: inline-block;
                        margin-top: 20px;
                        padding: 12px 24px;
                        background: #4CAF50;
                        color: white;
                        text-decoration: none;
                        border-radius: 6px;
                        transition: background 0.2s;
                    }
                    .btn:hover { background: #45a049; }
                </style>
            </head>
            <body>
                <div class="logout-box">
                    <h2>🚪 Logged Out</h2>
                    <p>You have been successfully logged out.</p>
                    <p>Your browser will forget your login credentials.</p>
                    <a href="/" class="btn">🔐 Login Again</a>
                </div>
            </body>
            </html>
        `);
    });
});

// API endpoints
app.post('/api/toggle-watched', (req, res) => {
    try {
        const { filePath } = req.body;
        if (!filePath) {
            return res.status(400).json({ error: 'File path is required' });
        }
        
        if (!movieTags[filePath]) {
            movieTags[filePath] = [];
        }
        
        const watchedIndex = movieTags[filePath].indexOf('watched');
        if (watchedIndex > -1) {
            movieTags[filePath].splice(watchedIndex, 1);
        } else {
            movieTags[filePath].push('watched');
        }
        
        saveTags();
        console.log(`[${new Date().toISOString()}] User ${req.auth.user} toggled watched status for: ${filePath}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error toggling watched status:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/add-tag', (req, res) => {
    try {
        const { filePath, tag } = req.body;
        if (!filePath || !tag) {
            return res.status(400).json({ error: 'File path and tag are required' });
        }
        
        if (!movieTags[filePath]) {
            movieTags[filePath] = [];
        }
        
        if (!movieTags[filePath].includes(tag)) {
            movieTags[filePath].push(tag);
            saveTags();
        }
        
        console.log(`[${new Date().toISOString()}] User ${req.auth.user} added tag "${tag}" to: ${filePath}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding tag:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/remove-tag', (req, res) => {
    try {
        const { filePath, tag } = req.body;
        if (!filePath || !tag) {
            return res.status(400).json({ error: 'File path and tag are required' });
        }
        
        if (movieTags[filePath]) {
            const tagIndex = movieTags[filePath].indexOf(tag);
            if (tagIndex > -1) {
                movieTags[filePath].splice(tagIndex, 1);
                saveTags();
            }
        }
        
        console.log(`[${new Date().toISOString()}] User ${req.auth.user} removed tag "${tag}" from: ${filePath}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing tag:', error);
        res.status(500).json({ error: error.message });
    }
});

// Enhanced stream endpoint with better path handling
app.get('/stream/:filename(*)', (req, res) => {
    try {
        // Get the full path including additional path segments
        const encodedPath = req.params.filename ;
        console.log('Raw encoded path:', encodedPath);
        
        const decodedPath = safeDecodeFilePath(encodedPath);
        console.log('Decoded path:', decodedPath);
        
        const fullPath = validateFilePath(decodedPath);
        console.log('Full file system path:', fullPath);
        
        if (!fs.existsSync(fullPath)) {
            console.error('File not found:', fullPath);
            return res.status(404).send('File not found');
        }

        if (!fs.statSync(fullPath).isFile()) {
            console.error('Path is not a file:', fullPath);
            return res.status(400).send('Path is not a file');
        }

        const stat = fs.statSync(fullPath);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        // Better MIME type detection
        const ext = path.extname(fullPath).toLowerCase();
        let contentType = 'video/mp4';
        
        switch (ext) {
            case '.mp4': contentType = 'video/mp4'; break;
            case '.avi': contentType = 'video/x-msvideo'; break;
            case '.mkv': contentType = 'video/x-matroska'; break;
            case '.mov': contentType = 'video/quicktime'; break;
            case '.wmv': contentType = 'video/x-ms-wmv'; break;
            case '.flv': contentType = 'video/x-flv'; break;
            case '.webm': contentType = 'video/webm'; break;
            case '.m4v': contentType = 'video/x-m4v'; break;
        }

        const protocol = req.secure ? 'HTTPS' : 'HTTP';
        console.log(`[${new Date().toISOString()}] ${protocol} - User ${req.auth.user} streaming: ${decodedPath}`);
        console.log(`File size: ${fileSize} bytes, Content-Type: ${contentType}`);

        // Set CORS headers for video streaming
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

        if (range) {
            console.log('Range request:', range);
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            
            if (start >= fileSize || end >= fileSize || start > end) {
                console.error('Invalid range:', { start, end, fileSize });
                return res.status(416).send('Range Not Satisfiable');
            }
            
            const chunksize = (end - start) + 1;
            console.log(`Serving range: ${start}-${end}/${fileSize} (${chunksize} bytes)`);
            
            const file = fs.createReadStream(fullPath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=0',
                'Access-Control-Allow-Origin': '*'
            };
            
            res.writeHead(206, head);
            
            file.on('error', (error) => {
                console.error('File stream error:', error);
                if (!res.headersSent) {
                    res.status(500).send('Stream error');
                }
            });
            
            file.on('end', () => {
                console.log('Range request completed successfully');
            });
            
            file.pipe(res);
        } else {
            console.log('Full file request');
            const head = {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=0',
                'Access-Control-Allow-Origin': '*'
            };
            res.writeHead(200, head);
            
            const fileStream = fs.createReadStream(fullPath);
            
            fileStream.on('error', (error) => {
                console.error('File stream error:', error);
                if (!res.headersSent) {
                    res.status(500).send('Stream error');
                }
            });
            
            fileStream.on('end', () => {
                console.log('Full file request completed successfully');
            });
            
            fileStream.pipe(res);
        }
    } catch (error) {
        console.error(`Stream error: ${error.message}`);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            error: 'Stream failed', 
            message: error.message,
            path: req.params.filename 
        });
    }
});

// Updated download endpoint with same path handling
app.get('/download/:filename(*)', (req, res) => {
    try {
        const encodedPath = req.params.filename + (req.params[0] ? req.params[0] : '');
        const decodedPath = safeDecodeFilePath(encodedPath);
        const fullPath = validateFilePath(decodedPath);
        
        if (!fs.existsSync(fullPath)) {
            return res.status(404).send('File not found');
        }

        if (!fs.statSync(fullPath).isFile()) {
            return res.status(400).send('Path is not a file');
        }
        
        const protocol = req.secure ? 'HTTPS' : 'HTTP';
        const filename = path.basename(decodedPath);
        console.log(`[${new Date().toISOString()}] ${protocol} - User ${req.auth.user} downloading: ${decodedPath}`);
        
        const stats = fs.statSync(fullPath);
        const fileSize = stats.size;
        
        // Set proper headers for download with better filename handling
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Cache-Control', 'no-cache');
        
        const fileStream = fs.createReadStream(fullPath);
        fileStream.pipe(res);
        
        fileStream.on('error', (error) => {
            console.error('Download stream error:', error);
            if (!res.headersSent) {
                res.status(500).send('Download failed');
            }
        });
        
    } catch (error) {
        console.error(`Download error: ${error.message}`);
        res.status(500).send('Download failed: ' + error.message);
    }
});

// Updated info endpoint
app.get('/info/:filename(*)', (req, res) => {
    try {
        const encodedPath = req.params.filename + (req.params[0] ? req.params[0] : '');
        const decodedPath = safeDecodeFilePath(encodedPath);
        const fullPath = validateFilePath(decodedPath);
        
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (!fs.statSync(fullPath).isFile()) {
            return res.status(400).json({ error: 'Path is not a file' });
        }
        
        const stats = fs.statSync(fullPath);
        const info = {
            name: path.basename(decodedPath),
            path: decodedPath,
            size: stats.size,
            sizeFormatted: `${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
            created: stats.birthtime,
            modified: stats.mtime,
            extension: path.extname(decodedPath),
            tags: movieTags[decodedPath] || []
        };
        
        res.json(info);
    } catch (error) {
        console.error(`Error getting file info: ${error.message}`);
        res.status(500).json({ error: 'Failed to get file info: ' + error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).send('Internal server error');
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Page not found');
});

// Start servers
function startServer() {
    // Create certs directory if it doesn't exist
    const certsDir = path.join(__dirname, 'certs');
    if (!fs.existsSync(certsDir)) {
        try {
            fs.mkdirSync(certsDir, { recursive: true });
            console.log('Created certs directory');
        } catch (error) {
            console.error('Failed to create certs directory:', error);
        }
    }

    const httpServer = http.createServer(app);
    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
        console.log(`📡 HTTP server running on port ${HTTP_PORT}`);
    });

    if (fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT)) {
        try {
            const privateKey = fs.readFileSync(SSL_KEY, 'utf8');
            const certificate = fs.readFileSync(SSL_CERT, 'utf8');
            const credentials = { key: privateKey, cert: certificate };

            const httpsServer = https.createServer(credentials, app);
            httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
                console.log(`🔒 HTTPS server running on port ${HTTPS_PORT}`);
                console.log(`📁 File System Media Server: https://blankmask.local:${HTTPS_PORT}`);
                console.log(`📂 Media root: ${MEDIA_ROOT}`);
                console.log(`🛡️ Security: HTTPS ✓ Auth ✓ Rate Limit ✓ File System Browser ✓`);
            });

            // Handle HTTPS server errors
            httpsServer.on('error', (error) => {
                console.error('HTTPS server error:', error);
            });

        } catch (error) {
            console.error('Failed to start HTTPS server:', error.message);
            console.log('Running HTTP only. Generate SSL certificates to enable HTTPS.');
        }
    } else {
        console.log('⚠️  SSL certificates not found. Running HTTP only.');
        console.log('📁 HTTP File System Media Server: http://blankmask.local:' + HTTP_PORT);
        console.log('⚠️  WARNING: HTTP is unencrypted! Generate SSL certificates for security.');
        console.log('📂 Media root:', MEDIA_ROOT);
        console.log('🔧 To enable HTTPS, run: openssl req -x509 -newkey rsa:2048 -keyout certs/server.key -out certs/server.crt -days 365 -nodes');
    }

    // Handle HTTP server errors
    httpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${HTTP_PORT} is already in use. Please choose a different port.`);
        } else {
            console.error('HTTP server error:', error);
        }
    });
}

// Validate media root folder on startup
if (!fs.existsSync(MEDIA_ROOT)) {
    console.error(`❌ Media root folder does not exist: ${MEDIA_ROOT}`);
    console.error('Please update the MEDIA_ROOT path in the code or create the directory.');
    process.exit(1);
}

if (!fs.statSync(MEDIA_ROOT).isDirectory()) {
    console.error(`❌ Media root path is not a directory: ${MEDIA_ROOT}`);
    process.exit(1);
}

startServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n📁 Shutting down File System Media Server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n📁 Shutting down File System Media Server...');
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});