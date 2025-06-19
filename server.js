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

// Change this to your movies folder path
const MOVIES_FOLDER = '/Volumes/VAMSHI/VAMSHI/anime and series';
const SUPPORTED_FORMATS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];

// Special folder that requires additional authentication
const TEMP_FOLDER = '.temp';
const TEMP_PASSWORD = 'temp123'; // Change this to your desired password

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

// Middleware to check temp folder access
function checkTempAccess(req, res, next) {
    const filename = req.params.filename || req.params[0] || '';
    const decodedFilename = decodeURIComponent(filename);
    
    if (decodedFilename.includes(TEMP_FOLDER)) {
        if (!req.session.tempAccess) {
            return res.status(403).json({
                error: 'Additional authentication required for .temp folder',
                requiresTempAuth: true
            });
        }
    }
    next();
}

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
    },
    challenge: true,
    realm: 'Advanced Media Server',
    unauthorizedResponse: (req) => {
        return 'Access denied. Please enter valid credentials.';
    }
});

app.use(express.json());
app.use(limiter);
app.use(basicAuth);

// Security functions
function sanitizePath(pathStr) {
    if (!pathStr || pathStr === '/') {
        return '';
    }
    
    // Remove leading/trailing slashes and normalize
    const normalizedPath = pathStr.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
    
    // Split path and validate each component
    const pathComponents = normalizedPath.split('/');
    for (const component of pathComponents) {
        if (component === '..') {
            throw new Error('Directory traversal detected');
        }
        if (component === '.' && component !== '.temp') {
            throw new Error('Invalid path component');
        }
    }
    
    return normalizedPath;
}

function validateAndResolvePath(relativePath) {
    try {
        const sanitizedPath = sanitizePath(relativePath);
        const fullPath = path.resolve(path.join(MOVIES_FOLDER, sanitizedPath));
        const moviesPath = path.resolve(MOVIES_FOLDER);
        
        // Check if path is within movies folder
        if (!fullPath.startsWith(moviesPath)) {
            throw new Error('Access denied - path outside movies folder');
        }
        
        return { fullPath, relativePath: sanitizedPath };
    } catch (error) {
        throw error;
    }
}

// Get directory contents (both folders and movies)
function getDirectoryContents(dirPath = '') {
    try {
        const { fullPath } = validateAndResolvePath(dirPath);
        
        if (!fs.existsSync(fullPath)) {
            return { directories: [], movies: [], currentPath: dirPath };
        }
        
        const items = fs.readdirSync(fullPath);
        const directories = [];
        const movies = [];
        
        for (const item of items) {
            const itemPath = path.join(fullPath, item);
            
            try {
                const stats = fs.statSync(itemPath);
                const relativePath = dirPath ? `${dirPath}/${item}` : item;
                
                if (stats.isDirectory()) {
                    const isInTempFolder = relativePath.includes('.temp') || item === '.temp';
                    directories.push({
                        name: item,
                        path: relativePath,
                        size: getDirectorySize(itemPath),
                        modified: stats.mtime,
                        requiresTempAuth: isInTempFolder
                    });
                } else if (SUPPORTED_FORMATS.includes(path.extname(item).toLowerCase())) {
                    const extension = path.extname(item).toLowerCase();
                    const nameWithoutExt = path.basename(item, extension);
                    const isInTempFolder = relativePath.includes('.temp');
                    
                    movies.push({
                        name: item,
                        displayName: nameWithoutExt,
                        path: relativePath,
                        size: stats.size,
                        sizeFormatted: `${(stats.size / 1024 / 1024 / 1024).toFixed(1)} GB`,
                        modified: stats.mtime,
                        created: stats.birthtime,
                        extension: extension,
                        tags: movieTags[relativePath] || [],
                        watched: (movieTags[relativePath] || []).includes('watched'),
                        folder: dirPath || 'root',
                        requiresTempAuth: isInTempFolder
                    });
                }
            } catch (error) {
                console.error(`Error processing item ${item}:`, error);
            }
        }
        
        return {
            directories: directories.sort((a, b) => a.name.localeCompare(b.name)),
            movies: movies.sort((a, b) => a.name.localeCompare(b.name)),
            currentPath: dirPath
        };
    } catch (error) {
        console.error(`Error reading directory ${dirPath}:`, error);
        return { directories: [], movies: [], currentPath: dirPath };
    }
}

// Calculate directory size
function getDirectorySize(dirPath) {
    let totalSize = 0;
    try {
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            try {
                const stats = fs.statSync(itemPath);
                if (stats.isDirectory()) {
                    totalSize += getDirectorySize(itemPath);
                } else {
                    totalSize += stats.size;
                }
            } catch (error) {
                // Skip files we can't access
            }
        }
    } catch (error) {
        console.error(`Error calculating directory size for ${dirPath}:`, error);
    }
    return totalSize;
}

// Enhanced movie information with subdirectory support
function getMovies() {
    try {
        if (!fs.existsSync(MOVIES_FOLDER)) {
            console.error('Movies folder does not exist:', MOVIES_FOLDER);
            return [];
        }
        
        return getAllMoviesRecursive(MOVIES_FOLDER);
    } catch (error) {
        console.error('Error reading movies folder:', error);
        return [];
    }
}

// Recursive function to get movies from subdirectories
function getAllMoviesRecursive(dir, relativePath = '') {
    const movies = [];
    
    try {
        const files = fs.readdirSync(dir);
        
        for (const file of files) {
            const filePath = path.join(dir, file);
            const fileRelativePath = relativePath ? `${relativePath}/${file}` : file;
            
            try {
                const stats = fs.statSync(filePath);
                
                if (stats.isDirectory()) {
                    // Recursively get movies from subdirectories
                    movies.push(...getAllMoviesRecursive(filePath, fileRelativePath));
                } else if (SUPPORTED_FORMATS.includes(path.extname(file).toLowerCase())) {
                    const extension = path.extname(file).toLowerCase();
                    const nameWithoutExt = path.basename(file, extension);
                    const isInTempFolder = fileRelativePath.includes('.temp') || relativePath.includes('.temp');
                    
                    movies.push({
                        name: file,
                        displayName: `${relativePath ? relativePath + '/' : ''}${nameWithoutExt}`,
                        path: fileRelativePath,
                        size: stats.size,
                        sizeFormatted: `${(stats.size / 1024 / 1024 / 1024).toFixed(1)} GB`,
                        modified: stats.mtime,
                        created: stats.birthtime,
                        extension: extension,
                        tags: movieTags[fileRelativePath] || [],
                        watched: (movieTags[fileRelativePath] || []).includes('watched'),
                        folder: relativePath || 'root',
                        requiresTempAuth: isInTempFolder
                    });
                }
            } catch (error) {
                console.error(`Error processing file ${file}:`, error);
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
    }
    
    return movies;
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

// Generate breadcrumb navigation
function generateBreadcrumbs(currentPath) {
    if (!currentPath) {
        return [{ name: 'Home', path: '' }];
    }
    
    const breadcrumbs = [{ name: 'Home', path: '' }];
    const pathParts = currentPath.split('/');
    let accumulatedPath = '';
    
    for (const part of pathParts) {
        accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
        breadcrumbs.push({
            name: part,
            path: accumulatedPath
        });
    }
    
    return breadcrumbs;
}

// Main page with directory navigation
app.get('/', (req, res) => {
    const currentPath = req.query.path || '';
    const view = req.query.view || 'browse'; // 'browse' or 'all'
    
    try {
        const hasTempAccess = req.session.tempAccess;
        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        
        let directories = [];
        let movies = [];
        let allMovies = [];
        
        if (view === 'browse') {
            const contents = getDirectoryContents(currentPath);
            directories = contents.directories.filter(dir => {
                if (dir.requiresTempAuth && !hasTempAccess) {
                    return false;
                }
                return true;
            });
            movies = contents.movies.filter(movie => {
                if (movie.requiresTempAuth && !hasTempAccess) {
                    return false;
                }
                return true;
            });
        } else {
            allMovies = getMovies().filter(movie => {
                if (movie.requiresTempAuth && !hasTempAccess) {
                    return false;
                }
                return true;
            });
        }
        
        const breadcrumbs = generateBreadcrumbs(currentPath);
        const allTags = getAllTags();
        const tempItemsCount = getMovies().filter(m => m.requiresTempAuth).length + 
                              getDirectoryContents().directories.filter(d => d.requiresTempAuth).length;
        
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>📱 Advanced Media Server</title>
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
                    padding: 15px 20px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .breadcrumb-item {
                    color: #4CAF50;
                    text-decoration: none;
                    padding: 5px 10px;
                    border-radius: 4px;
                    transition: background 0.2s;
                }

                .breadcrumb-item:hover {
                    background: rgba(76, 175, 80, 0.2);
                }

                .breadcrumb-item.current {
                    color: white;
                    background: rgba(255,255,255,0.1);
                }

                .breadcrumb-separator {
                    color: #666;
                    margin: 0 5px;
                }

                .view-selector {
                    display: flex;
                    gap: 10px;
                    justify-content: center;
                    margin-bottom: 20px;
                }

                .view-btn {
                    padding: 10px 20px;
                    border: 1px solid #4CAF50;
                    background: transparent;
                    color: #4CAF50;
                    border-radius: 6px;
                    cursor: pointer;
                    text-decoration: none;
                    transition: all 0.2s;
                }

                .view-btn.active {
                    background: #4CAF50;
                    color: white;
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

                .view-toggle-btn {
                    padding: 8px 16px;
                    border: 1px solid #4CAF50;
                    background: transparent;
                    color: #4CAF50;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .view-toggle-btn.active {
                    background: #4CAF50;
                    color: white;
                }

                .stats {
                    text-align: center;
                    color: #888;
                    margin-bottom: 20px;
                }

                /* Directory Grid */
                .directories-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: 15px;
                    margin-bottom: 30px;
                }

                .directory {
                    background: rgba(255, 193, 7, 0.1);
                    border: 1px solid rgba(255, 193, 7, 0.3);
                    border-radius: 8px;
                    padding: 15px;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                    cursor: pointer;
                }

                .directory:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 15px rgba(255, 193, 7, 0.2);
                }

                .directory-icon {
                    font-size: 2em;
                    margin-bottom: 10px;
                }

                .directory-name {
                    font-weight: 600;
                    color: #FFC107;
                    margin-bottom: 5px;
                }

                .directory-info {
                    font-size: 0.85em;
                    color: #888;
                }

                /* Movies Grid */
                .movies-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 20px;
                }

                /* List View */
                .movies-list .movie {
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    padding: 15px;
                    margin-bottom: 15px;
                }

                .movies-list .movie-content {
                    flex: 1;
                    min-width: 0;
                }

                .movies-list video {
                    width: 150px;
                    height: 85px;
                    object-fit: cover;
                }

                /* Card View (Default) */
                .movie {
                    background: rgba(51,51,51,0.8);
                    border-radius: 12px;
                    border: 1px solid rgba(255,255,255,0.1);
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                    position: relative;
                    overflow: hidden;
                }

                .movie:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 8px 25px rgba(0,0,0,0.3);
                }

                .movie-header {
                    padding: 15px;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }

                .movie-title {
                    margin: 0 0 8px 0;
                    color: #4CAF50;
                    font-size: 1.1em;
                    font-weight: 600;
                    word-break: break-word;
                }

                .movie-info {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 0.85em;
                    color: #888;
                    margin-bottom: 10px;
                }

                .movie-tags {
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

                .movie-content {
                    padding: 15px;
                }

                video {
                    width: 100%;
                    max-height: 200px;
                    border-radius: 8px;
                    background: #000;
                    margin-bottom: 15px;
                }

                .movie-actions {
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

                .section-header {
                    font-size: 1.3em;
                    font-weight: 600;
                    margin: 30px 0 15px 0;
                    color: #4CAF50;
                    border-bottom: 2px solid rgba(76, 175, 80, 0.3);
                    padding-bottom: 8px;
                }

                @media (max-width: 768px) {
                    body { padding: 10px; }
                    .controls {
                        grid-template-columns: 1fr;
                        gap: 10px;
                    }
                    .movies-grid, .directories-grid {
                        grid-template-columns: 1fr;
                    }
                    .movies-list .movie {
                        flex-direction: column;
                        align-items: flex-start;
                    }
                    .movies-list video {
                        width: 100%;
                        height: auto;
                    }
                    .breadcrumbs {
                        overflow-x: auto;
                        white-space: nowrap;
                    }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>📱 Advanced Media Server</h1>
                <div>User: ${req.auth.user} • ${view === 'browse' ? `${directories.length} folders • ${movies.length} movies` : `${allMovies.length} total movies`}${tempItemsCount > 0 ? ` • ${tempItemsCount} temp items ${hasTempAccess ? 'accessible' : 'locked 🔒'}` : ''}</div>
                <div style="margin-top: 8px; padding: 8px; border-radius: 6px; background: ${isSecure ? 'rgba(76, 175, 80, 0.2)' : 'rgba(244, 67, 54, 0.2)'}; border: 1px solid ${isSecure ? '#4CAF50' : '#f44336'};">
                    ${isSecure ? '🔒 Secure HTTPS Connection' : '⚠️ UNENCRYPTED HTTP - Your data is visible to others!'}
                </div>
                ${tempItemsCount > 0 && !hasTempAccess ? `
                <div style="margin-top: 8px; text-align: center;">
                    <button onclick="showTempAuth()" class="btn" style="background: #FF9800; border-color: #FF9800;">🔓 Unlock .temp folder (${tempItemsCount} items)</button>
                </div>
                ` : ''}
                ${hasTempAccess ? `
                <div style="margin-top: 8px; text-align: center;">
                    <span style="color: #4CAF50;">✅ .temp folder unlocked</span> • 
                    <button onclick="lockTempFolder()" class="btn btn-secondary" style="font-size: 0.8em;">🔒 Lock</button>
                </div>
                ` : ''}
            </div>

            ${view === 'browse' ? `
            <nav class="breadcrumbs">
                ${breadcrumbs.map((crumb, index) => `
                    ${index > 0 ? '<span class="breadcrumb-separator">></span>' : ''}
                    <a href="/?path=${encodeURIComponent(crumb.path)}&view=browse" 
                       class="breadcrumb-item ${index === breadcrumbs.length - 1 ? 'current' : ''}">
                        ${index === 0 ? '🏠' : '📁'} ${crumb.name}
                    </a>
                `).join('')}
            </nav>
            ` : ''}

            <div class="view-selector">
                <a href="/?path=${encodeURIComponent(currentPath)}&view=browse" class="view-btn ${view === 'browse' ? 'active' : ''}">
                    📁 Browse Folders
                </a>
                <a href="/?view=all" class="view-btn ${view === 'all' ? 'active' : ''}">
                    📋 All Movies
                </a>
            </div>

            ${view === 'all' ? `
            <div class="controls">
                <input type="text" class="search-box" placeholder="🔍 Search movies..." id="searchBox">
                
                <select class="sort-select" id="sortSelect">
                    <option value="modified-desc">📅 Newest First</option>
                    <option value="modified-asc">📅 Oldest First</option>
                    <option value="name-asc">🔤 Name A-Z</option>
                    <option value="name-desc">🔤 Name Z-A</option>
                    <option value="size-desc">📦 Largest First</option>
                    <option value="size-asc">📦 Smallest First</option>
                </select>

                <select class="filter-select" id="filterSelect">
                    <option value="">📋 All Movies</option>
                    <option value="watched">👀 Watched</option>
                    <option value="unwatched">🆕 Unwatched</option>
                    ${allTags.map(tag => `<option value="${tag}">🏷️ ${tag}</option>`).join('')}
                </select>

                <div class="view-toggles">
                    <button class="view-toggle-btn active" data-view="grid">🔲 Grid</button>
                    <button class="view-toggle-btn" data-view="list">📋 List</button>
                </div>
            </div>

            <div class="stats" id="statsDisplay">
                Showing ${allMovies.length} movies
            </div>
            ` : ''}

            <div class="movies-container" id="moviesContainer">
                ${view === 'browse' ? `
                    ${directories.length > 0 ? `
                    <div class="section-header">📁 Folders</div>
                    <div class="directories-grid">
                        ${directories.map(dir => `
                        <div class="directory" onclick="window.location.href='/?path=${encodeURIComponent(dir.path)}&view=browse'">
                            <div class="directory-icon">${dir.name === '.temp' ? '🔒' : '📁'}</div>
                            <div class="directory-name">${dir.name}</div>
                            <div class="directory-info">
                                ${(dir.size / 1024 / 1024 / 1024).toFixed(1)} GB • ${new Date(dir.modified).toLocaleDateString()}
                            </div>
                        </div>
                        `).join('')}
                    </div>
                    ` : ''}

                    ${movies.length > 0 ? `
                    <div class="section-header">🎬 Movies in this folder</div>
                    <div class="movies-grid" id="moviesGrid">
                        ${movies.map(movie => {
                            const safeId = movie.path.replace(/[^a-zA-Z0-9]/g, '');
                            const safePath = movie.path.replace(/'/g, "\\'");
                            return `
                            <div class="movie" data-name="${movie.displayName.toLowerCase()}" data-tags="${movie.tags.join(',')}" data-size="${movie.size}" data-modified="${new Date(movie.modified).getTime()}">
                                <div class="movie-header">
                                    <h3 class="movie-title">${movie.displayName}</h3>
                                    <div class="movie-info">
                                        <span class="size">${movie.sizeFormatted}</span>
                                        <span class="date">${new Date(movie.modified).toLocaleDateString()}</span>
                                    </div>
                                    <div class="movie-tags">
                                        ${movie.tags.map(tag => `<span class="tag ${tag}">${tag}</span>`).join('')}
                                    </div>
                                </div>
                                
                                <div class="movie-content">
                                    <video controls preload="metadata" poster="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMzMzIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzY2NiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkNsaWNrIHRvIFBsYXk8L3RleHQ+PC9zdmc+">
                                        <source src="/stream/${encodeURIComponent(movie.path)}" type="video/mp4">
                                        Your browser doesn't support video streaming.
                                    </video>
                                    
                                    <div class="movie-actions">
                                        <a href="/download/${encodeURIComponent(movie.path)}" class="btn">⬇️ Download</a>
                                        <button class="btn btn-secondary" onclick="toggleWatched('${safePath}')">
                                            ${movie.watched ? '👁️ Watched' : '👀 Mark Watched'}
                                        </button>
                                        <button class="btn btn-secondary" onclick="toggleTagEditor('${safeId}')">🏷️ Tags</button>
                                        <a href="/info/${encodeURIComponent(movie.path)}" class="btn btn-secondary">ℹ️ Info</a>
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
                    ` : ''}

                    ${directories.length === 0 && movies.length === 0 ? `
                    <div class="no-results">This folder is empty</div>
                    ` : ''}
                ` : `
                    <div class="movies-grid" id="moviesGrid">
                        ${allMovies.map(movie => {
                            const safeId = movie.path.replace(/[^a-zA-Z0-9]/g, '');
                            const safePath = movie.path.replace(/'/g, "\\'");
                            return `
                            <div class="movie" data-name="${movie.displayName.toLowerCase()}" data-tags="${movie.tags.join(',')}" data-size="${movie.size}" data-modified="${new Date(movie.modified).getTime()}">
                                <div class="movie-header">
                                    <h3 class="movie-title">${movie.displayName}</h3>
                                    <div class="movie-info">
                                        <span class="size">${movie.sizeFormatted}</span>
                                        <span class="date">${new Date(movie.modified).toLocaleDateString()}</span>
                                    </div>
                                    <div class="movie-tags">
                                        ${movie.tags.map(tag => `<span class="tag ${tag}">${tag}</span>`).join('')}
                                    </div>
                                </div>
                                
                                <div class="movie-content">
                                    <video controls preload="metadata" poster="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMzMzIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzY2NiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkNsaWNrIHRvIFBsYXk8L3RleHQ+PC9zdmc+">
                                        <source src="/stream/${encodeURIComponent(movie.path)}" type="video/mp4">
                                        Your browser doesn't support video streaming.
                                    </video>
                                    
                                    <div class="movie-actions">
                                        <a href="/download/${encodeURIComponent(movie.path)}" class="btn">⬇️ Download</a>
                                        <button class="btn btn-secondary" onclick="toggleWatched('${safePath}')">
                                            ${movie.watched ? '👁️ Watched' : '👀 Mark Watched'}
                                        </button>
                                        <button class="btn btn-secondary" onclick="toggleTagEditor('${safeId}')">🏷️ Tags</button>
                                        <a href="/info/${encodeURIComponent(movie.path)}" class="btn btn-secondary">ℹ️ Info</a>
                                        <a href="/?path=${encodeURIComponent(movie.folder)}&view=browse" class="btn btn-secondary">📁 Folder</a>
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
                const currentView = '${view}';
                let movies = ${view === 'all' ? JSON.stringify(allMovies) : JSON.stringify(movies)};
                let filteredMovies = [...movies];

                // Search functionality (only for 'all' view)
                if (currentView === 'all') {
                    document.getElementById('searchBox').addEventListener('input', filterMovies);
                    document.getElementById('sortSelect').addEventListener('change', filterMovies);
                    document.getElementById('filterSelect').addEventListener('change', filterMovies);

                    // View toggle functionality
                    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                            
                            const view = btn.dataset.view;
                            const container = document.getElementById('moviesGrid');
                            
                            if (view === 'list') {
                                container.className = 'movies-list';
                            } else {
                                container.className = 'movies-grid';
                            }
                        });
                    });
                }

                function filterMovies() {
                    if (currentView !== 'all') return;

                    const searchTerm = document.getElementById('searchBox').value.toLowerCase();
                    const sortBy = document.getElementById('sortSelect').value;
                    const filterBy = document.getElementById('filterSelect').value;

                    // Filter movies
                    filteredMovies = movies.filter(movie => {
                        const matchesSearch = movie.displayName.toLowerCase().includes(searchTerm) || 
                                            movie.tags.some(tag => tag.toLowerCase().includes(searchTerm));
                        
                        let matchesFilter = true;
                        if (filterBy === 'watched') {
                            matchesFilter = movie.watched;
                        } else if (filterBy === 'unwatched') {
                            matchesFilter = !movie.watched;
                        } else if (filterBy && filterBy !== '') {
                            matchesFilter = movie.tags.includes(filterBy);
                        }

                        return matchesSearch && matchesFilter;
                    });

                    // Sort movies
                    filteredMovies.sort((a, b) => {
                        const [field, order] = sortBy.split('-');
                        let comparison = 0;

                        switch (field) {
                            case 'name':
                                comparison = a.displayName.localeCompare(b.displayName);
                                break;
                            case 'size':
                                comparison = a.size - b.size;
                                break;
                            case 'modified':
                                comparison = new Date(a.modified) - new Date(b.modified);
                                break;
                        }

                        return order === 'desc' ? -comparison : comparison;
                    });

                    renderMovies();
                    updateStats();
                }

                function renderMovies() {
                    if (currentView !== 'all') return;

                    const container = document.getElementById('moviesGrid');
                    
                    if (filteredMovies.length === 0) {
                        container.innerHTML = '<div class="no-results">No movies found matching your criteria</div>';
                        return;
                    }

                    // Hide all movies first
                    document.querySelectorAll('.movie').forEach(movie => {
                        movie.classList.add('hidden');
                    });

                    // Show filtered movies
                    filteredMovies.forEach(movie => {
                        const movieElement = document.querySelector('[data-name="' + movie.displayName.toLowerCase() + '"]');
                        if (movieElement) {
                            movieElement.classList.remove('hidden');
                        }
                    });
                }

                function updateStats() {
                    if (currentView !== 'all') return;

                    const total = filteredMovies.length;
                    const watched = filteredMovies.filter(m => m.watched).length;
                    const totalSize = filteredMovies.reduce((sum, m) => sum + m.size, 0);
                    const sizeGB = (totalSize / 1024 / 1024 / 1024).toFixed(1);

                    document.getElementById('statsDisplay').textContent = 
                        'Showing ' + total + ' movies • ' + watched + ' watched • ' + sizeGB + ' GB total';
                }

                function toggleWatched(moviePath) {
                    fetch('/api/toggle-watched', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ moviePath })
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

                function addQuickTag(moviePath, tag) {
                    addTag(moviePath, tag);
                }

                function addCustomTag(moviePath, tag) {
                    if (tag && tag.trim()) {
                        addTag(moviePath, tag.trim());
                        // Clear input
                        const input = event.target;
                        if (input) {
                            input.value = '';
                        }
                    }
                }

                function addTag(moviePath, tag) {
                    fetch('/api/add-tag', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ moviePath, tag })
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

                function showTempAuth() {
                    const password = prompt('Enter password for .temp folder:');
                    if (password) {
                        fetch('/api/temp-auth', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ password })
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                location.reload();
                            } else {
                                alert('Incorrect password');
                            }
                        })
                        .catch(error => {
                            console.error('Error:', error);
                            alert('Authentication failed');
                        });
                    }
                }

                function lockTempFolder() {
                    fetch('/api/temp-lock', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            location.reload();
                        }
                    })
                    .catch(error => {
                        console.error('Error:', error);
                    });
                }

                // Initialize
                if (currentView === 'all') {
                    filterMovies();
                }
            </script>
        </body>
        </html>
        `;
        res.send(html);
    } catch (error) {
        console.error('Error serving main page:', error);
        res.status(500).send('Internal server error');
    }
});

// Directory browsing API endpoint
app.get('/api/browse/:path(*)', checkTempAccess, (req, res) => {
    try {
        const requestedPath = req.params.path || '';
        const contents = getDirectoryContents(requestedPath);
        
        // Filter based on temp access
        const hasTempAccess = req.session.tempAccess;
        const filteredContents = {
            ...contents,
            directories: contents.directories.filter(dir => {
                if (dir.requiresTempAuth && !hasTempAccess) {
                    return false;
                }
                return true;
            }),
            movies: contents.movies.filter(movie => {
                if (movie.requiresTempAuth && !hasTempAccess) {
                    return false;
                }
                return true;
            })
        };
        
        res.json(filteredContents);
    } catch (error) {
        console.error('Error browsing directory:', error);
        res.status(403).json({ error: 'Access denied' });
    }
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

app.post('/api/toggle-watched', (req, res) => {
    try {
        const { moviePath } = req.body;
        if (!moviePath) {
            return res.status(400).json({ error: 'Movie path is required' });
        }
        
        if (!movieTags[moviePath]) {
            movieTags[moviePath] = [];
        }
        
        const watchedIndex = movieTags[moviePath].indexOf('watched');
        if (watchedIndex > -1) {
            movieTags[moviePath].splice(watchedIndex, 1);
        } else {
            movieTags[moviePath].push('watched');
        }
        
        saveTags();
        console.log(`[${new Date().toISOString()}] User ${req.auth.user} toggled watched status for: ${moviePath}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error toggling watched status:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/add-tag', (req, res) => {
    try {
        const { moviePath, tag } = req.body;
        if (!moviePath || !tag) {
            return res.status(400).json({ error: 'Movie path and tag are required' });
        }
        
        if (!movieTags[moviePath]) {
            movieTags[moviePath] = [];
        }
        
        if (!movieTags[moviePath].includes(tag)) {
            movieTags[moviePath].push(tag);
            saveTags();
        }
        
        console.log(`[${new Date().toISOString()}] User ${req.auth.user} added tag "${tag}" to: ${moviePath}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding tag:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/remove-tag', (req, res) => {
    try {
        const { moviePath, tag } = req.body;
        if (!moviePath || !tag) {
            return res.status(400).json({ error: 'Movie path and tag are required' });
        }
        
        if (movieTags[moviePath]) {
            const tagIndex = movieTags[moviePath].indexOf(tag);
            if (tagIndex > -1) {
                movieTags[moviePath].splice(tagIndex, 1);
                saveTags();
            }
        }
        
        console.log(`[${new Date().toISOString()}] User ${req.auth.user} removed tag "${tag}" from: ${moviePath}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing tag:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/temp-auth', (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        
        if (password === TEMP_PASSWORD) {
            req.session.tempAccess = true;
            console.log(`[${new Date().toISOString()}] User ${req.auth.user} authenticated for .temp folder`);
            res.json({ success: true });
        } else {
            console.log(`[${new Date().toISOString()}] User ${req.auth.user} failed .temp authentication`);
            res.json({ success: false, error: 'Incorrect password' });
        }
    } catch (error) {
        console.error('Error in temp auth:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/temp-lock', (req, res) => {
    try {
        req.session.tempAccess = false;
        console.log(`[${new Date().toISOString()}] User ${req.auth.user} locked .temp folder`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error locking temp folder:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stream endpoint with better error handling
app.get('/stream/:filename(*)', checkTempAccess, (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const { fullPath } = validateAndResolvePath(filename);
        
        if (!fs.existsSync(fullPath)) {
            return res.status(404).send('File not found');
        }

        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            return res.status(403).send('Cannot stream directories');
        }

        const fileSize = stat.size;
        const range = req.headers.range;

        const protocol = req.secure ? 'HTTPS' : 'HTTP';
        console.log(`[${new Date().toISOString()}] ${protocol} - User ${req.auth.user} streaming: ${filename}`);

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            
            if (start >= fileSize || end >= fileSize) {
                return res.status(416).send('Range Not Satisfiable');
            }
            
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(fullPath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/mp4',
                'Cache-Control': 'no-cache'
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
                'Cache-Control': 'no-cache'
            };
            res.writeHead(200, head);
            fs.createReadStream(fullPath).pipe(res);
        }
    } catch (error) {
        console.error(`Security violation attempt: ${error.message}`);
        res.status(403).send('Access denied');
    }
});

app.get('/download/:filename(*)', checkTempAccess, (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const { fullPath } = validateAndResolvePath(filename);
        
        if (!fs.existsSync(fullPath)) {
            return res.status(404).send('File not found');
        }

        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            return res.status(403).send('Cannot download directories');
        }
        
        const protocol = req.secure ? 'HTTPS' : 'HTTP';
        console.log(`[${new Date().toISOString()}] ${protocol} - User ${req.auth.user} downloading: ${filename}`);
        
        const fileSize = stat.size;
        
        // Set proper headers for download
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filename))}`);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Cache-Control', 'no-cache');
        
        // Stream the file
        const fileStream = fs.createReadStream(fullPath);
        fileStream.pipe(res);
        
        fileStream.on('error', (error) => {
            console.error('File stream error:', error);
            if (!res.headersSent) {
                res.status(500).send('Download failed');
            }
        });
        
    } catch (error) {
        console.error(`Security violation attempt: ${error.message}`);
        res.status(403).send('Access denied');
    }
});

app.get('/info/:filename(*)', checkTempAccess, (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const { fullPath, relativePath } = validateAndResolvePath(filename);
        
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
            return res.status(403).json({ error: 'Cannot get info for directories' });
        }

        const info = {
            name: filename,
            size: stats.size,
            sizeFormatted: `${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
            created: stats.birthtime,
            modified: stats.mtime,
            extension: path.extname(filename),
            tags: movieTags[relativePath] || []
        };
        
        res.json(info);
    } catch (error) {
        console.error(`Error getting file info: ${error.message}`);
        res.status(403).json({ error: 'Access denied' });
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
                console.log(`🎬 Advanced Media Server: https://blankmask.local:${HTTPS_PORT}`);
                console.log(`📁 Movies folder: ${MOVIES_FOLDER}`);
                console.log(`🛡️ Security: HTTPS ✓ Auth ✓ Rate Limit ✓ Tags ✓ Directory Browsing ✓`);
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
        console.log('🎬 HTTP Media Server: http://blankmask.local:' + HTTP_PORT);
        console.log('⚠️  WARNING: HTTP is unencrypted! Generate SSL certificates for security.');
        console.log('📁 Movies folder:', MOVIES_FOLDER);
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

// Validate movies folder on startup
if (!fs.existsSync(MOVIES_FOLDER)) {
    console.error(`❌ Movies folder does not exist: ${MOVIES_FOLDER}`);
    console.error('Please update the MOVIES_FOLDER path in the code or create the directory.');
    process.exit(1);
}

startServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🎬 Shutting down Advanced Media Server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🎬 Shutting down Advanced Media Server...');
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