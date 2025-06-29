const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const auth = require('express-basic-auth');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const ffmpeg = require('fluent-ffmpeg');
const { spawn } = require('child_process');

const app = express();
const HTTP_PORT = 3001;
const HTTPS_PORT = 3444;

// Configuration
const MEDIA_ROOT = '/Volumes/VAMSHI/VAMSHI/';
const HIDDEN_FOLDERS = {
    'vamshi': [],  // vamshi can see everything
    'blankmask': ['.temp']  // family cannot see these folders
};
const SUPPORTED_FORMATS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];

// SSL Certificate paths
const SSL_KEY = path.join(__dirname, 'certs', 'server.key');
const SSL_CERT = path.join(__dirname, 'certs', 'server.crt');

// Tags database
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

loadTags();

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Allow localhost in any form
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
            return callback(null, true);
        }
        
        // Allow blankmask.local (your Bonjour hostname)
        if (origin.includes('blankmask.local')) {
            return callback(null, true);
        }
        
        // Allow your local network IP addresses
        const localNetworkRegex = /^https?:\/\/(192\.168\.|10\.|172\.16\.|172\.17\.|172\.18\.|172\.19\.|172\.2[0-9]\.|172\.3[0-1]\.)/;
        if (localNetworkRegex.test(origin)) {
            return callback(null, true);
        }
        
        // For development, allow all origins
        return callback(null, true);
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range']
};
// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Add device detection middleware
function detectDevice(req, res, next) {
    const userAgent = req.headers['user-agent'] || '';
    
    // More comprehensive mobile detection
    req.isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Windows Phone/i.test(userAgent);
    req.isSafari = /Safari/i.test(userAgent) && !/Chrome/i.test(userAgent);
    req.isIOS = /iPhone|iPad|iPod/i.test(userAgent);
    req.isAndroid = /Android/i.test(userAgent);
    
    // Log device info for debugging
    console.log(`📱 Device detected - Mobile: ${req.isMobile}, iOS: ${req.isIOS}, Android: ${req.isAndroid}`);
    
    next();
}

// Apply device detection to all routes
app.use(detectDevice);


// Session configuration
app.use(session({
    secret: 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'mediaserver.sid',
    cookie: { 
        secure: false,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));
// Serve React build files (static assets)
app.use(express.static(path.join(__dirname, '../frontend-vite/dist')));


// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// app.use(limiter);

// Basic authentication
const basicAuth = auth({
    users: { 
        'vamshi': 'abe124',
        'blankmask': 'helloworld'
    },
    challenge: true,
    realm: 'Advanced Media Server',
    unauthorizedResponse: (req) => {
        return { error: 'Access denied. Please enter valid credentials.' };
    }
});

// Apply auth to all routes except OPTIONS
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        next();
    } else {
        basicAuth(req, res, next);
    }
});

// Path utilities
function sanitizePath(inputPath) {
    if (!inputPath) return '';
    const sanitized = inputPath.replace(/\.\./g, '').replace(/\/+/g, '/');
    return sanitized.startsWith('/') ? sanitized.substring(1) : sanitized;
}

function safeEncodeFilePath(filePath) {
    return filePath.split('/').map(segment => {
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

function safeDecodeFilePath(encodedPath) {
    try {
        let decoded = decodeURIComponent(encodedPath);
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

// Get directory contents
function getDirectoryContents(relativePath = '', username = 'family') {
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
        
        // Get hidden folders for this user
        const hiddenFolders = HIDDEN_FOLDERS[username] || [];
        
        items.forEach(item => {
            try {
                const itemPath = path.join(fullPath, item);
                const stats = fs.statSync(itemPath);
                const itemRelativePath = path.join(relativePath, item).replace(/\\/g, '/');
                
                if (stats.isDirectory()) {
                    // Check if this folder should be hidden from the current user
                    const shouldHide = hiddenFolders.some(hiddenFolder => {
                        // Check if the folder name matches (case-insensitive)
                        return item.toLowerCase() === hiddenFolder.toLowerCase() ||
                               item.toLowerCase().includes(hiddenFolder.toLowerCase());
                    });
                    
                    if (shouldHide) {
                        console.log(`Hiding folder "${item}" from user "${username}"`);
                        return; // Skip this folder
                    }
                    
                    let mediaCount = 0;
                    let subfolderCount = 0;
                    try {
                        const subItems = fs.readdirSync(itemPath);
                        // Count both media files and subfolders
                        subItems.forEach(subItem => {
                            const subItemPath = path.join(itemPath, subItem);
                            try {
                                const subStats = fs.statSync(subItemPath);
                                if (subStats.isFile() && SUPPORTED_FORMATS.includes(path.extname(subItem).toLowerCase())) {
                                    mediaCount++;
                                } else if (subStats.isDirectory()) {
                                    subfolderCount++; // Count subdirectories
                                }
                            } catch {
                                // Ignore items we can't read
                            }
                        });
                    } catch {
                        mediaCount = 0;
                        subfolderCount = 0; // Reset counts if we can't read the directory
                    }
                    
                    folders.push({
                        name: item,
                        path: itemRelativePath,
                        type: 'folder',
                        modified: stats.mtime,
                        mediaCount: mediaCount,
                        subfolderCount: subfolderCount,
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

// Add subtitle extraction function
async function extractSubtitles(videoPath, outputDir) {
    return new Promise((resolve, reject) => {
        const subtitleTracks = [];
        
        // First, probe the video to find subtitle streams
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                console.error('FFprobe error:', err);
                return resolve([]); // No subtitles available
            }
            
            const streams = metadata.streams || [];
            const subtitleStreams = streams.filter(stream => 
                stream.codec_type === 'subtitle' && 
                (stream.codec_name === 'subrip' || stream.codec_name === 'ass' || stream.codec_name === 'webvtt')
            );
            
            if (subtitleStreams.length === 0) {
                return resolve([]); // No subtitle streams found
            }
            
            // Extract each subtitle stream
            let extractionPromises = [];
            
            subtitleStreams.forEach((stream, index) => {
                const language = stream.tags?.language || `track${index}`;
                const title = stream.tags?.title || `Subtitle ${index + 1}`;
                const outputPath = path.join(outputDir, `subtitle_${index}.vtt`);
                
                const extractionPromise = new Promise((resolveExtraction, rejectExtraction) => {
                    ffmpeg(videoPath)
                        .outputOptions([
                            `-map 0:s:${index}`, // Map subtitle stream
                            '-c:s webvtt'        // Convert to WebVTT format
                        ])
                        .output(outputPath)
                        .on('end', () => {
                            subtitleTracks.push({
                                index: index,
                                language: language,
                                title: title,
                                path: outputPath,
                                url: `/api/subtitle/${encodeURIComponent(path.relative(MEDIA_ROOT, videoPath))}/${index}`
                            });
                            resolveExtraction();
                        })
                        .on('error', (extractErr) => {
                            console.error(`Subtitle extraction error for stream ${index}:`, extractErr);
                            resolveExtraction(); // Don't fail the whole process
                        })
                        .run();
                });
                
                extractionPromises.push(extractionPromise);
            });
            
            Promise.all(extractionPromises).then(() => {
                resolve(subtitleTracks);
            });
        });
    });
}

// API Routes

// Get current user info
app.get('/api/user', (req, res) => {
    res.json({
        username: req.auth.user,
        isAuthenticated: true
    });
});

// Get directory contents
app.get('/api/browse', (req, res) => {
    try {
        const currentPath = req.query.path || '';
        const username = req.auth.user; // Get the authenticated username
        
        const contents = getDirectoryContents(currentPath, username);
        const breadcrumbs = generateBreadcrumbs(currentPath);
        const allTags = getAllTags();
        
        res.json({
            ...contents,
            breadcrumbs,
            allTags,
            user: username  // Include username in response
        });
    } catch (error) {
        console.error('Browse error:', error);
        res.status(500).json({ error: error.message });
    }
});


// Toggle watched status
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
        res.json({ success: true, watched: movieTags[filePath].includes('watched') });
    } catch (error) {
        console.error('Error toggling watched status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add tag
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
        res.json({ success: true, tags: movieTags[filePath] });
    } catch (error) {
        console.error('Error adding tag:', error);
        res.status(500).json({ error: error.message });
    }
});

// Remove tag
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
        res.json({ success: true, tags: movieTags[filePath] || [] });
    } catch (error) {
        console.error('Error removing tag:', error);
        res.status(500).json({ error: error.message });
    }
});

// Also need to check folder access for streaming/downloading
function validateFolderAccess(filePath, username) {
    const hiddenFolders = HIDDEN_FOLDERS[username] || [];
    const pathParts = filePath.split('/');
    
    for (const hiddenFolder of hiddenFolders) {
        if (pathParts.some(part => part.toLowerCase() === hiddenFolder.toLowerCase())) {
            return false; // Access denied
        }
    }
    return true; // Access allowed
}

// Stream subtitle
// Add subtitle serving endpoint
app.get('/api/subtitle/:filename(*)/:track', async (req, res) => {
    try {
        const encodedPath = req.params.filename;
        const trackIndex = parseInt(req.params.track);
        const decodedPath = safeDecodeFilePath(encodedPath);
        const fullVideoPath = validateFilePath(decodedPath);

        console.log(`Serving subtitle for video: ${decodedPath}, track index: ${trackIndex}`);
        
        if (!fs.existsSync(fullVideoPath)) {
            return res.status(404).send('Video file not found');
        }
        
        // Create temp directory for subtitles
        const tempDir = path.join(__dirname, 'temp', 'subtitles');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const videoBasename = path.basename(fullVideoPath, path.extname(fullVideoPath));
        const subtitlePath = path.join(tempDir, `${videoBasename}_${trackIndex}.vtt`);
        
        // ADD THIS HELPER FUNCTION FOR CLEANING
        const cleanSubtitleContent = (content) => {
            return content
                // Remove translator notes and alternatives in curly braces
                .replace(/\{[^}]*\}/g, '')
        };
        
        // Check if subtitle already extracted
        if (fs.existsSync(subtitlePath)) {
            // READ, CLEAN, AND SEND THE SUBTITLE
            fs.readFile(subtitlePath, 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading subtitle file:', err);
                    return res.status(500).send('Error reading subtitle file');
                }
                console.log(`Using cached subtitle for: ${decodedPath}, track index: ${trackIndex}`);
                const cleanedContent = cleanSubtitleContent(data);
                console.log('Sending cleaned subtitle content');
                res.setHeader('Content-Type', 'text/vtt');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.send(cleanedContent);
            });
            return;
        }
        
        // Extract subtitle on demand
        ffmpeg(fullVideoPath)
            .outputOptions([
                `-map 0:s:${trackIndex}`,
                '-c:s webvtt'
            ])
            .output(subtitlePath)
            .on('end', () => {
                // READ, CLEAN, AND SEND THE NEWLY EXTRACTED SUBTITLE
                fs.readFile(subtitlePath, 'utf8', (err, data) => {
                    if (err) {
                        console.error('Error reading extracted subtitle:', err);
                        return res.status(500).send('Error reading extracted subtitle');
                    }
                    
                    const cleanedContent = cleanSubtitleContent(data);
                    console.log(`cleanedContent`, cleanedContent);
                    console.log(`Subtitle extracted and cleaned for: ${decodedPath}, track index: ${trackIndex}`);
                    res.setHeader('Content-Type', 'text/vtt');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.send(cleanedContent);
                });
            })
            .on('error', (err) => {
                console.error('Subtitle extraction error:', err);
                res.status(500).send('Subtitle extraction failed');
            })
            .run();
            
    } catch (error) {
        console.error('Subtitle serving error:', error);
        res.status(500).send('Subtitle serving failed');
    }
});

// Add subtitle info endpoint
app.get('/api/subtitle-info/:filename(*)', async (req, res) => {
    try {
        const encodedPath = req.params.filename;
        const decodedPath = safeDecodeFilePath(encodedPath);
        const fullVideoPath = validateFilePath(decodedPath);
        
        if (!fs.existsSync(fullVideoPath)) {
            return res.status(404).json({ error: 'Video file not found' });
        }
        
        // Probe video for subtitle streams
        ffmpeg.ffprobe(fullVideoPath, (err, metadata) => {
            if (err) {
                console.error('FFprobe error:', err);
                return res.json({ subtitles: [] });
            }
            
            const streams = metadata.streams || [];
            const subtitleStreams = streams
                .filter(stream => stream.codec_type === 'subtitle')
                .map((stream, index) => ({
                    index: stream.index,
                    trackIndex: index,
                    language: stream.tags?.language || 'unknown',
                    title: stream.tags?.title || `Subtitle ${index + 1}`,
                    codec: stream.codec_name,
                    url: `/api/subtitle/${encodeURIComponent(decodedPath)}/${index}`
                }));
            
            console.log(`Found ${subtitleStreams.length} subtitle streams for: ${decodedPath}`);
            console.log('Subtitle streams:', subtitleStreams);
            res.json({ subtitles: subtitleStreams });
        });
        
    } catch (error) {
        console.error('Subtitle info error:', error);
        res.status(500).json({ error: 'Failed to get subtitle info' });
    }
});

// Stream video
app.get('/api/stream/:filename(*)', (req, res) => {
    try {
        // In your /api/stream route, add:
        const encodedPath = req.params.filename;
        console.log('Raw encoded path:', encodedPath);
        
        const decodedPath = safeDecodeFilePath(encodedPath);
        console.log('Decoded path:', decodedPath);
        
        const fullPath = validateFilePath(decodedPath);
        console.log('Full file system path:', fullPath);

        const username = req.auth.user;
        console.log(`User ${username} requested stream for xxxxxx: ${decodedPath}`);
        // Validate folder access
        if (!validateFolderAccess(decodedPath, username)) {
            console.error(`Access denied for user ${username} to path: ${decodedPath}`);
            return res.status(403).send('Access denied');
        }
        
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
        
        // MIME type detection
        const ext = path.extname(fullPath).toLowerCase();

        // Check if transcoding is needed for mobile devices
        // const needsTranscoding = req.isMobile && (ext === '.mkv' || ext === '.avi' || ext === '.wmv');
        
        // if (needsTranscoding) {
        //     console.log(`📱 Transcoding ${ext} for mobile device`);
        //     return streamWithTranscoding(req, res, fullPath, decodedPath);
        // }

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

        // Set CORS headers
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
                'Cache-Control': 'public, max-age=0'
            };
            
            res.writeHead(206, head);
            
            file.on('error', (error) => {
                console.error('File stream error:', error);
                if (!res.headersSent) {
                    res.status(500).send('Stream error');
                }
            });
            
            file.pipe(res);
        } else {
            console.log('Full file request');
            const head = {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=0'
            };
            res.writeHead(200, head);
            
            const fileStream = fs.createReadStream(fullPath);
            
            fileStream.on('error', (error) => {
                console.error('File stream error:', error);
                if (!res.headersSent) {
                    res.status(500).send('Stream error');
                }
            });
            
            fileStream.pipe(res);
        }
    } catch (error) {
        console.error(`Stream error: ${error.message}`);
        res.status(500).json({ 
            error: 'Stream failed', 
            message: error.message
        });
    }
});

// Transcoding function for mobile devices
// REPLACE your existing streamWithTranscoding function with this improved version

function streamWithTranscoding(req, res, inputPath, displayPath) {
    const range = req.headers.range;
    
    console.log(`🔄 Starting transcoding for: ${displayPath}`);
    
    // Set headers for MP4 streaming
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Handle range requests by starting from beginning (transcoding limitation)
    if (range) {
        console.log('📱 Range request detected, but transcoding from start for mobile compatibility');
    }
    
    // Check if input file exists and is readable
    if (!fs.existsSync(inputPath)) {
        console.error('❌ Input file not found:', inputPath);
        return res.status(404).send('File not found');
    }
    
    // More robust FFmpeg command with error handling
    let ffmpegCommand;
    
    try {
        ffmpegCommand = ffmpeg(inputPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .format('mp4')
            .addOptions([
                '-preset veryfast',            // Faster than ultrafast but more stable
                '-crf 28',                     // Slightly lower quality for faster encoding
                '-profile:v main',             // More compatible than baseline
                '-level 4.0',                  // Higher level for better compatibility
                '-movflags +frag_keyframe+empty_moov+faststart', // Better streaming
                '-pix_fmt yuv420p',           // Wide compatibility
                '-max_muxing_queue_size 1024', // Smaller buffer to prevent memory issues
                '-avoid_negative_ts make_zero', // Handle timing issues
                '-fflags +genpts',            // Generate presentation timestamps
                '-threads 0'                   // Use all available CPU cores
            ])
            // Add size/quality constraints for mobile
            .size('1280x720')                 // Limit resolution for mobile
            .videoBitrate('1000k')            // Limit bitrate
            .audioBitrate('128k')             // Standard audio bitrate
            .on('start', (commandLine) => {
                console.log('📱 FFmpeg started with command:');
                console.log(commandLine);
            })
            .on('progress', (progress) => {
                if (progress.percent && progress.percent > 0) {
                    console.log(`📱 Transcoding progress: ${Math.round(progress.percent)}%`);
                } else if (progress.timemark) {
                    console.log(`📱 Transcoding time: ${progress.timemark}`);
                }
            })
            .on('stderr', (stderrLine) => {
                // Log important stderr messages but not every line
                if (stderrLine.includes('error') || stderrLine.includes('Error') || 
                    stderrLine.includes('failed') || stderrLine.includes('Failed')) {
                    console.error('📱 FFmpeg stderr:', stderrLine);
                }
            })
            .on('error', (err, stdout, stderr) => {
                console.error('📱 Transcoding error:', err.message);
                console.error('📱 FFmpeg stdout:', stdout);
                console.error('📱 FFmpeg stderr:', stderr);
                
                if (!res.headersSent) {
                    // Send a more helpful error message
                    if (err.message.includes('does not contain any stream')) {
                        res.status(422).send('Video file appears to be corrupted or unreadable');
                    } else if (err.message.includes('Permission denied')) {
                        res.status(403).send('Permission denied accessing video file');
                    } else if (err.message.includes('No such file')) {
                        res.status(404).send('Video file not found');
                    } else {
                        res.status(500).send('Video transcoding failed - try downloading instead');
                    }
                }
            })
            .on('end', () => {
                console.log('📱 Transcoding completed successfully');
            });
        
        // Handle client disconnect
        req.on('close', () => {
            console.log('📱 Client disconnected, stopping transcoding');
            if (ffmpegCommand) {
                ffmpegCommand.kill('SIGTERM'); // More graceful than SIGKILL
                setTimeout(() => {
                    if (ffmpegCommand) {
                        ffmpegCommand.kill('SIGKILL'); // Force kill if still running
                    }
                }, 2000);
            }
        });
        
        // Handle server errors
        req.on('error', (err) => {
            console.error('📱 Request error:', err);
            if (ffmpegCommand) {
                ffmpegCommand.kill('SIGTERM');
            }
        });
        
        // Start streaming
        res.writeHead(200);
        
        // Pipe the transcoded stream to response
        const stream = ffmpegCommand.pipe();
        stream.pipe(res);
        
        // Handle stream errors
        stream.on('error', (err) => {
            console.error('📱 Stream error:', err);
            if (!res.destroyed) {
                res.destroy();
            }
        });
        
    } catch (error) {
        console.error('📱 Failed to create FFmpeg command:', error);
        if (!res.headersSent) {
            res.status(500).send('Failed to initialize video transcoding');
        }
    }
}

app.get('/api/transcode-info/:filename(*)', (req, res) => {
    try {
        const encodedPath = req.params.filename;
        const decodedPath = safeDecodeFilePath(encodedPath);
        const ext = path.extname(decodedPath).toLowerCase();
        
        const needsTranscoding = req.isMobile && (ext === '.mkv' || ext === '.avi' || ext === '.wmv');
        
        res.json({
            needsTranscoding,
            isMobile: req.isMobile,
            originalFormat: ext,
            reason: needsTranscoding ? 'Mobile device detected with incompatible format' : 'Format compatible'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Download file
app.get('/api/download/:filename(*)', (req, res) => {
    try {
        const encodedPath = req.params.filename;
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

// Get file info
app.get('/api/info/:filename(*)', (req, res) => {
    try {
        const encodedPath = req.params.filename;
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

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destruction error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.clearCookie('mediaserver.sid');
        res.json({ success: true });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start servers
function startServer() {
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
        console.log(`📡 HTTP API server running on port ${HTTP_PORT}`);
    });

    if (fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT)) {
        try {
            const privateKey = fs.readFileSync(SSL_KEY, 'utf8');
            const certificate = fs.readFileSync(SSL_CERT, 'utf8');
            const credentials = { key: privateKey, cert: certificate };

            const httpsServer = https.createServer(credentials, app);
            httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
                console.log(`🔒 HTTPS API server running on port ${HTTPS_PORT}`);
                console.log(`📁 Media Server API: https://localhost:${HTTPS_PORT}`);
                console.log(`📂 Media root: ${MEDIA_ROOT}`);
            });

            httpsServer.on('error', (error) => {
                console.error('HTTPS server error:', error);
            });

        } catch (error) {
            console.error('Failed to start HTTPS server:', error.message);
            console.log('Running HTTP only.');
        }
    } else {
        console.log('⚠️  SSL certificates not found. Running HTTP only.');
        console.log('📁 HTTP Media Server API: http://localhost:' + HTTP_PORT);
    }

    httpServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${HTTP_PORT} is already in use.`);
        } else {
            console.error('HTTP server error:', error);
        }
    });
}

// Validate media root
if (!fs.existsSync(MEDIA_ROOT)) {
    console.error(`❌ Media root folder does not exist: ${MEDIA_ROOT}`);
    console.error('Please update the MEDIA_ROOT path or create the directory.');
    process.exit(1);
}

if (!fs.statSync(MEDIA_ROOT).isDirectory()) {
    console.error(`❌ Media root path is not a directory: ${MEDIA_ROOT}`);
    process.exit(1);
}

startServer();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n📁 Shutting down Media Server API...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n📁 Shutting down Media Server API...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Serve React app for all non-API routes (this must be the LAST route)
app.get('*', (req, res) => {
  // Only serve React app for non-API routes
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend-vite/dist/index.html'));
  } else {
    // If it's an API route that doesn't exist, return 404
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

app.get('/api/mobile-download/:filename(*)', (req, res) => {
    try {
        const encodedPath = req.params.filename;
        const decodedPath = safeDecodeFilePath(encodedPath);
        const fullPath = validateFilePath(decodedPath);
        const username = req.auth.user;
        
        // Validate access
        if (!validateFolderAccess(decodedPath, username)) {
            return res.status(403).send('Access denied');
        }
        
        if (!fs.existsSync(fullPath)) {
            return res.status(404).send('File not found');
        }
        
        const filename = path.basename(decodedPath);
        const stats = fs.statSync(fullPath);
        
        console.log(`📱 Mobile download requested: ${decodedPath}`);
        
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        const fileStream = fs.createReadStream(fullPath);
        fileStream.pipe(res);
        
        fileStream.on('error', (error) => {
            console.error('📱 Mobile download error:', error);
            if (!res.headersSent) {
                res.status(500).send('Download failed');
            }
        });
        
    } catch (error) {
        console.error('📱 Mobile download error:', error);
        res.status(500).send('Download failed');
    }
});