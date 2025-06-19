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
const MOVIES_FOLDER = '/Volumes/VAMSHI/VAMSHI/anime and series/.temp';
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

// Security functions
function sanitizeFilename(filename) {
    const sanitized = path.basename(filename);
    if (!/^[a-zA-Z0-9\s.\-_()]+$/.test(sanitized)) {
        throw new Error('Invalid filename');
    }
    return sanitized;
}

function validateFilePath(filename) {
    const sanitizedFilename = sanitizeFilename(filename);
    const filePath = path.resolve(path.join(MOVIES_FOLDER, sanitizedFilename));
    const moviesPath = path.resolve(MOVIES_FOLDER);
    
    if (!filePath.startsWith(moviesPath)) {
        throw new Error('Access denied');
    }
    return filePath;
}

// Enhanced movie information
function getMovies() {
    try {
        if (!fs.existsSync(MOVIES_FOLDER)) {
            console.error('Movies folder does not exist:', MOVIES_FOLDER);
            return [];
        }
        
        const files = fs.readdirSync(MOVIES_FOLDER);
        return files
            .filter(file => SUPPORTED_FORMATS.includes(path.extname(file).toLowerCase()))
            .map(file => {
                try {
                    const filePath = path.join(MOVIES_FOLDER, file);
                    const stats = fs.statSync(filePath);
                    const extension = path.extname(file).toLowerCase();
                    const nameWithoutExt = path.basename(file, extension);
                    
                    return {
                        name: file,
                        displayName: nameWithoutExt,
                        path: file,
                        size: stats.size,
                        sizeFormatted: `${(stats.size / 1024 / 1024 / 1024).toFixed(1)} GB`,
                        modified: stats.mtime,
                        created: stats.birthtime,
                        extension: extension,
                        tags: movieTags[file] || [],
                        watched: (movieTags[file] || []).includes('watched')
                    };
                } catch (error) {
                    console.error(`Error reading file ${file}:`, error);
                    return null;
                }
            })
            .filter(movie => movie !== null);
    } catch (error) {
        console.error('Error reading movies folder:', error);
        return [];
    }
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

// Main page with advanced UI
app.get('/', (req, res) => {
    const movies = getMovies();
    const allTags = getAllTags();
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    
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

            @media (max-width: 768px) {
                body { padding: 10px; }
                .controls {
                    grid-template-columns: 1fr;
                    gap: 10px;
                }
                .movies-grid {
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
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📱 Advanced Media Server</h1>
            <div>User: ${req.auth.user} • ${movies.length} movies</div>
            <div style="margin-top: 8px; padding: 8px; border-radius: 6px; background: ${isSecure ? 'rgba(76, 175, 80, 0.2)' : 'rgba(244, 67, 54, 0.2)'}; border: 1px solid ${isSecure ? '#4CAF50' : '#f44336'};">
                ${isSecure ? '🔒 Secure HTTPS Connection' : '⚠️ UNENCRYPTED HTTP - Your data is visible to others!'}
            </div>
        </div>

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
                <button class="view-btn active" data-view="grid">🔲 Grid</button>
                <button class="view-btn" data-view="list">📋 List</button>
            </div>
        </div>

        <div class="stats" id="statsDisplay">
            Showing ${movies.length} movies
        </div>

        <div class="movies-container" id="moviesContainer">
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
        </div>

        <script>
            let movies = ${JSON.stringify(movies)};
            let filteredMovies = [...movies];

            // Search functionality
            document.getElementById('searchBox').addEventListener('input', filterMovies);
            document.getElementById('sortSelect').addEventListener('change', filterMovies);
            document.getElementById('filterSelect').addEventListener('change', filterMovies);

            // View toggle functionality
            document.querySelectorAll('.view-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
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

            function filterMovies() {
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

            // Initialize
            filterMovies();
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

app.post('/api/toggle-watched', (req, res) => {
    try {
        const { moviePath } = req.body;
        if (!moviePath) {
            return res.status(400).json({ error: 'Movie path is required' });
        }
        
        const filename = path.basename(moviePath);
        
        if (!movieTags[filename]) {
            movieTags[filename] = [];
        }
        
        const watchedIndex = movieTags[filename].indexOf('watched');
        if (watchedIndex > -1) {
            movieTags[filename].splice(watchedIndex, 1);
        } else {
            movieTags[filename].push('watched');
        }
        
        saveTags();
        console.log(`[${new Date().toISOString()}] User ${req.auth.user} toggled watched status for: ${filename}`);
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
        
        const filename = path.basename(moviePath);
        
        if (!movieTags[filename]) {
            movieTags[filename] = [];
        }
        
        if (!movieTags[filename].includes(tag)) {
            movieTags[filename].push(tag);
            saveTags();
        }
        
        console.log(`[${new Date().toISOString()}] User ${req.auth.user} added tag "${tag}" to: ${filename}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding tag:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/remove-tag', (req, res) => {
    try {
        const { moviePath, tag } = req.body;
        if (!moviePath || !tag) {
            return res.status(400).json({ error: 'Movie path and tag are required' });
        }
        
        const filename = path.basename(moviePath);
        
        if (movieTags[filename]) {
            const tagIndex = movieTags[filename].indexOf(tag);
            if (tagIndex > -1) {
                movieTags[filename].splice(tagIndex, 1);
                saveTags();
            }
        }
        
        console.log(`[${new Date().toISOString()}] User ${req.auth.user} removed tag "${tag}" from: ${filename}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing tag:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stream endpoint with better error handling
app.get('/stream/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = validateFilePath(filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('File not found');
        }

        const stat = fs.statSync(filePath);
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
            const file = fs.createReadStream(filePath, { start, end });
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
            fs.createReadStream(filePath).pipe(res);
        }
    } catch (error) {
        console.error(`Security violation attempt: ${error.message}`);
        res.status(403).send('Access denied');
    }
});

app.get('/download/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = validateFilePath(filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('File not found');
        }
        
        const protocol = req.secure ? 'HTTPS' : 'HTTP';
        console.log(`[${new Date().toISOString()}] ${protocol} - User ${req.auth.user} downloading: ${filename}`);
        
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        
        // Set proper headers for download
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Cache-Control', 'no-cache');
        
        // Stream the file
        const fileStream = fs.createReadStream(filePath);
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

app.get('/info/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = validateFilePath(filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const stats = fs.statSync(filePath);
        const baseFilename = path.basename(filename);
        const info = {
            name: filename,
            size: stats.size,
            sizeFormatted: `${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
            created: stats.birthtime,
            modified: stats.mtime,
            extension: path.extname(filename),
            tags: movieTags[baseFilename] || []
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
                console.log(`🛡️ Security: HTTPS ✓ Auth ✓ Rate Limit ✓ Tags ✓`);
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