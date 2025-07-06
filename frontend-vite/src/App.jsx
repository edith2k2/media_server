import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Search, 
  Folder, 
  Film, 
  Download, 
  Eye, 
  EyeOff, 
  Tag, 
  Grid, 
  List, 
  ChevronRight,
  Home,
  Lock,
  AlertTriangle,
  Play,
  Settings,
  Plus,
  Upload,
  FolderPlus,
  X,
  CheckCircle
} from 'lucide-react';
import { UploadModal, FloatingUploadButton } from './components/Upload';
import { useApi, API_BASE } from './utils/Api';

// Breadcrumb component
function Breadcrumbs({ breadcrumbs, onNavigate }) {
  return (
    <nav className="flex items-center gap-2 p-4 bg-gray-800 rounded-lg mb-6">
      {breadcrumbs.map((crumb, index) => (
        <React.Fragment key={crumb.path}>
          {index > 0 && <ChevronRight className="w-4 h-4 text-gray-400" />}
          <button
            onClick={() => onNavigate(crumb.path)}
            className={`flex items-center gap-2 px-3 py-1 rounded text-sm transition-colors ${
              index === breadcrumbs.length - 1
                ? 'text-gray-400 cursor-default'
                : 'text-green-400 hover:bg-gray-700'
            }`}
            disabled={index === breadcrumbs.length - 1}
          >
            {index === 0 ? <Home className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
            {crumb.name}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

// Search and filter controls
function Controls({ 
  searchTerm, 
  onSearchChange, 
  sortBy, 
  onSortChange, 
  filterBy, 
  onFilterChange, 
  viewMode, 
  onViewModeChange, 
  allTags,
  subtitleSettings,
  onSubtitleSettingsChange 
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-gray-800 rounded-lg mb-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search files and folders..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
        />
      </div>

      <select
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value)}
        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
      >
        <option value="name-asc">Name A-Z</option>
        <option value="name-desc">Name Z-A</option>
        <option value="modified-desc">Newest First</option>
        <option value="modified-asc">Oldest First</option>
        <option value="size-desc">Largest First</option>
        <option value="size-asc">Smallest First</option>
      </select>

      <select
        value={filterBy}
        onChange={(e) => onFilterChange(e.target.value)}
        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
      >
        <option value="">All Items</option>
        <option value="folders">Folders Only</option>
        <option value="files">Files Only</option>
        <option value="watched">Watched</option>
        <option value="unwatched">Unwatched</option>
        {allTags.map(tag => (
          <option key={tag} value={tag}>{tag}</option>
        ))}
      </select>

      <select
        value={subtitleSettings.language}
        onChange={(e) => onSubtitleSettingsChange({...subtitleSettings, language: e.target.value})}
        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500"
      >
        <option value="all">All Subtitles</option>
        <option value="en">English Only</option>
        <option value="es">Spanish Only</option>
        <option value="fr">French Only</option>
        <option value="de">German Only</option>
        <option value="ja">Japanese Only</option>
        <option value="none">No Subtitles</option>
      </select>

      <div className="flex gap-2">
        <button
          onClick={() => onViewModeChange('grid')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
            viewMode === 'grid'
              ? 'bg-green-600 border-green-500 text-white'
              : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <Grid className="w-4 h-4" />
          Grid
        </button>
        <button
          onClick={() => onViewModeChange('list')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
            viewMode === 'list'
              ? 'bg-green-600 border-green-500 text-white'
              : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <List className="w-4 h-4" />
          List
        </button>
      </div>
    </div>
  );
}

// Tag component
function TagBadge({ tag, onClick, onRemove }) {
  const getTagColor = (tag) => {
    switch (tag) {
      case 'watched': return 'bg-blue-600';
      case 'favorite': return 'bg-red-600';
      case 'series': return 'bg-purple-600';
      case 'movie': return 'bg-orange-600';
      default: return 'bg-green-600';
    }
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-white cursor-pointer ${getTagColor(tag)}`}
      onClick={onClick}
    >
      {tag}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1 hover:bg-black hover:bg-opacity-20 rounded-full p-0.5"
        >
          ×
        </button>
      )}
    </span>
  );
}

// Tag editor component
function TagEditor({ filePath, currentTags, onTagsChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [newTag, setNewTag] = useState('');
  const { apiCall } = useApi();

  const quickTags = ['favorite', 'series', 'movie', 'action', 'comedy', 'drama', 'sci-fi'];

  const addTag = async (tag) => {
    try {
      await apiCall('/add-tag', {
        method: 'POST',
        body: JSON.stringify({ filePath, tag })
      });
      onTagsChange([...currentTags, tag]);
    } catch (error) {
      console.error('Failed to add tag:', error);
    }
  };

  const removeTag = async (tag) => {
    try {
      await apiCall('/remove-tag', {
        method: 'DELETE',
        body: JSON.stringify({ filePath, tag })
      });
      onTagsChange(currentTags.filter(t => t !== tag));
    } catch (error) {
      console.error('Failed to remove tag:', error);
    }
  };

  const handleAddCustomTag = async (e) => {
    e.preventDefault();
    if (newTag.trim() && !currentTags.includes(newTag.trim())) {
      await addTag(newTag.trim());
      setNewTag('');
    }
  };

  return (
    <div className="mt-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm transition-colors"
      >
        <Tag className="w-4 h-4" />
        Edit Tags
      </button>

      {isOpen && (
        <div className="mt-3 p-3 bg-gray-800 rounded-lg border border-gray-600">
          <div className="flex flex-wrap gap-2 mb-3">
            {quickTags.map(tag => (
              <button
                key={tag}
                onClick={() => addTag(tag)}
                disabled={currentTags.includes(tag)}
                className={`px-2 py-1 rounded text-xs border transition-colors ${
                  currentTags.includes(tag)
                    ? 'bg-gray-600 border-gray-500 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-700 border-gray-500 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {currentTags.map(tag => (
              <TagBadge
                key={tag}
                tag={tag}
                onClick={() => removeTag(tag)}
                onRemove={() => removeTag(tag)}
              />
            ))}
          </div>

          <form onSubmit={handleAddCustomTag} className="flex gap-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Add custom tag..."
              className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
            />
            <button
              type="submit"
              className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm transition-colors"
            >
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// VideoPlayer component - only renders video when explicitly requested
function VideoPlayer({ filePath, title, onClose, subtitleSettings }) {
  const [subtitles, setSubtitles] = useState([]);
  const [loadingSubtitles, setLoadingSubtitles] = useState(true);
  const encodedPath = encodeURIComponent(filePath);
  const streamUrl = `${API_BASE}/stream/${encodedPath}`;

  // Load subtitle information only when player is actually rendered
  useEffect(() => {
    const loadSubtitles = async () => {
      try {
        const response = await fetch(`${API_BASE}/subtitle-info/${encodedPath}`, {
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          let filteredSubtitles = data.subtitles || [];
          
          // Filter by language preference
          if (subtitleSettings.language !== 'all') {
            filteredSubtitles = filteredSubtitles.filter(subtitle => {
              const lang = subtitle.language?.toLowerCase() || '';
              return lang === subtitleSettings.language || 
                     lang.startsWith(subtitleSettings.language + '-');
            });
          }
          setSubtitles(filteredSubtitles);
        }
      } catch (error) {
        console.error('Failed to load subtitle info:', error);
      } finally {
        setLoadingSubtitles(false);
      }
    };

    loadSubtitles();
  }, [encodedPath, subtitleSettings]);

  return (
    <div className="relative">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 z-10 bg-red-600 hover:bg-red-500 text-white rounded-full w-8 h-8 flex items-center justify-center transition-colors"
      >
        ×
      </button>
      
      <video
        controls
        preload="metadata"
        className="w-full max-h-48 rounded-lg bg-black"
        onError={(e) => {
          console.error('Video error for:', filePath, e);
        }}
        crossOrigin="anonymous"
        autoPlay // Start playing when loaded
      >
        <source src={streamUrl} type="video/mp4" />
        <source src={streamUrl} type="video/webm" />
        <source src={streamUrl} type="video/x-matroska" />
        <source src={streamUrl} type="video/mkv" />
        <source src={streamUrl} type="video/avi" />
        <source src={streamUrl} type="video/mov" />
        <source src={streamUrl} type="video/quicktime" />
        
        {/* Add subtitle tracks */}
        {subtitles.map((subtitle, index) => (
          <track
            key={subtitle.trackIndex}
            kind="subtitles"
            src={`${API_BASE}/subtitle/${encodedPath}/${subtitle.trackIndex}`}
            srcLang={subtitle.language}
            label={subtitle.title}
            default={index === 0}
          />
        ))}
        
        <div className="p-4 text-center text-gray-400">
          <p>Your browser doesn't support video streaming.</p>
          <p className="text-sm mt-2">{title}</p>
        </div>
      </video>
      
      {/* Show subtitle info */}
      {!loadingSubtitles && subtitles.length > 0 && (
        <div className="mt-2 text-xs text-gray-400">
          📝 {subtitles.length} subtitle track(s): {subtitles.map(s => s.language).join(', ')}
        </div>
      )}
      
      {!loadingSubtitles && subtitles.length === 0 && subtitleSettings.language !== 'none' && (
        <div className="mt-2 text-xs text-gray-400">
          No {subtitleSettings.language === 'all' ? '' : subtitleSettings.language} subtitles available
        </div>
      )}
    </div>
  );
}

// Play button component - shows before video loads
function PlayButton({ onClick, hasSubtitles, viewMode, filePath }) {
  const [thumbnail, setThumbnail] = useState(null);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const buttonRef = useRef(null);

  // Check if thumbnail is already cached
  const getCachedThumbnail = useCallback((path) => {
    return sessionStorage.getItem(`thumb_${btoa(path)}`);
  }, []);

  const setCachedThumbnail = useCallback((path, dataURL) => {
    try {
      sessionStorage.setItem(`thumb_${btoa(path)}`, dataURL);
    } catch (error) {
      console.warn('Failed to cache thumbnail:', error);
    }
  }, []);

  // Intersection Observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (buttonRef.current) {
      observer.observe(buttonRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Generate thumbnail only when needed
  useEffect(() => {
    if (!filePath || !isVisible || thumbnailLoaded) return;
    
    // Check cache first
    const cached = getCachedThumbnail(filePath);
    if (cached) {
      setThumbnail(cached);
      setThumbnailLoaded(true);
      return;
    }

    // Only generate on hover or after delay
    const generateThumbnail = () => {
      const encodedPath = encodeURIComponent(filePath);
      const streamUrl = `${API_BASE}/stream/${encodedPath}`;
      
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'metadata';
      video.muted = true;
      video.volume = 0;
      
      let timeoutId;
      
      const cleanup = () => {
        clearTimeout(timeoutId);
        video.remove();
        setThumbnailLoaded(true);
      };

      video.addEventListener('loadedmetadata', () => {
        // Seek to a good frame (avoid black frames at start)
        const seekTime = Math.min(video.duration * 0.1, 30); // Max 30 seconds
        video.currentTime = seekTime;
      });
      
      video.addEventListener('seeked', () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 180;
          const ctx = canvas.getContext('2d');
          
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataURL = canvas.toDataURL('image/jpeg', 0.6); // Lower quality
          
          setThumbnail(dataURL);
          setCachedThumbnail(filePath, dataURL);
        } catch (error) {
          console.error('Failed to generate thumbnail:', error);
        } finally {
          cleanup();
        }
      });
      
      video.addEventListener('error', cleanup);
      
      // Timeout fallback
      timeoutId = setTimeout(cleanup, 10000); // 10 second timeout
      
      video.src = streamUrl;
    };

    if (isHovered) {
      generateThumbnail();
    } else {
      // Delay generation to avoid loading all at once
      const timer = setTimeout(generateThumbnail, Math.random() * 2000 + 1000);
      return () => clearTimeout(timer);
    }
  }, [filePath, isVisible, thumbnailLoaded, isHovered, getCachedThumbnail, setCachedThumbnail]);

  return (
    <div 
      ref={buttonRef}
      className={`bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-600 transition-colors relative overflow-hidden ${
        viewMode === 'grid' ? 'h-48' : 'h-18'
      }`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Background thumbnail (always absolute to prevent size changes) */}
      {thumbnail && (
        <img 
          src={thumbnail} 
          alt="Video preview"
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      )}
      
      {/* Overlay content (always absolute to maintain consistent sizing) */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {/* Dark overlay for better contrast when thumbnail is present */}
        {thumbnail && (
          <div className="absolute inset-0 bg-black bg-opacity-40" />
        )}
        
        {/* Content layer */}
        <div className="relative z-10 flex flex-col items-center justify-center">
          <Play className={`w-12 h-12 drop-shadow-lg ${
            thumbnail ? 'text-white' : 'text-green-500'
          }`} />
          
          {viewMode === 'grid' && (
            <div className="text-center mt-2">
              <p className={`text-sm drop-shadow-lg ${
                thumbnail ? 'text-white' : 'text-gray-300'
              }`}>
                Click to play
              </p>
              {hasSubtitles && !thumbnail && (
                <p className="text-blue-400 text-xs mt-1">📝 CC Available</p>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Subtitle indicator (always in same position) */}
      {hasSubtitles && (
        <span className="absolute top-1 right-1 text-blue-400 text-xs bg-black bg-opacity-60 px-1 rounded z-20">
          📝
        </span>
      )}
    </div>
  );
}

// Optimized MediaItem component - no unnecessary API calls
function MediaItem({ item, viewMode, onNavigate, onTagsChange, isPlaying, onPlayToggle, subtitleSettings }) {
  const { apiCall } = useApi();
  const [tags, setTags] = useState(item.tags || []);
  const [watched, setWatched] = useState(item.watched || false);
  const [subtitleInfo, setSubtitleInfo] = useState(null);
  const [subtitleInfoLoaded, setSubtitleInfoLoaded] = useState(false);

  // console.log('Rendering MediaItem:', item.path, 'isPlaying:', isPlaying);

  // Only check for subtitles when user shows interest (hover or click)
  const checkSubtitles = useCallback(async () => {
    if (subtitleInfoLoaded || item.type !== 'file') return;
    
    try {
      const encodedPath = encodeURIComponent(item.path);
      const response = await fetch(`${API_BASE}/subtitle-info/${encodedPath}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setSubtitleInfo(data.subtitles || []);
      }
    } catch (error) {
      console.error('Failed to check subtitles:', error);
      setSubtitleInfo([]);
    } finally {
      setSubtitleInfoLoaded(true);
    }
  }, [item.path, item.type, subtitleInfoLoaded]);

  const toggleWatched = async () => {
    try {
      const result = await apiCall('/toggle-watched', {
        method: 'POST',
        body: JSON.stringify({ filePath: item.path })
      });
      setWatched(result.watched);
      
      const newTags = result.watched 
        ? [...tags.filter(t => t !== 'watched'), 'watched']
        : tags.filter(t => t !== 'watched');
      setTags(newTags);
    } catch (error) {
      console.error('Failed to toggle watched:', error);
    }
  };

  const handleTagsChange = (newTags) => {
    setTags(newTags);
    if (onTagsChange) {
      onTagsChange(newTags);
    }
  };

  const handlePlayClick = () => {
    onPlayToggle(item.path, true);
    // Check for subtitles when user actually wants to play
    if (!subtitleInfoLoaded) {
      checkSubtitles();
    }
  };

  const handleStopClick = () => {
    onPlayToggle(item.path, false);
  };

  const downloadUrl = `${API_BASE}/download/${encodeURIComponent(item.path)}`;

  if (item.type === 'folder') {
    return (
      <div 
        className={`bg-gray-800 rounded-lg border border-gray-700 hover:border-orange-500 transition-all cursor-pointer ${
          viewMode === 'list' ? 'flex items-center gap-4 p-4' : 'p-4'
        }`}
        onClick={() => onNavigate(item.path)}
      >
        <div className="flex items-center gap-3 mb-2">
          <Folder className="w-6 h-6 text-orange-500" />
          <h3 className="text-lg font-semibold text-white">{item.name}</h3>
        </div>
        <div className="text-sm text-gray-400">
          <p>
            📁 {item.subfolderCount || 0} folders • 
            🎬 {item.mediaCount || 0} media files
          </p>
          <p>Modified: {new Date(item.modified).toLocaleDateString()}</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`bg-gray-800 rounded-lg border border-gray-700 hover:border-green-500 transition-all ${
        viewMode === 'list' ? 'flex gap-4 p-4' : 'p-4'
      }`}
      onMouseEnter={checkSubtitles} // Check subtitles on hover for better UX
    >
      {/* Video preview/play area */}
      <div className={viewMode === 'list' ? 'w-32 h-18 mb-4' : 'mb-4'}>
        {isPlaying ? (
          <VideoPlayer 
            filePath={item.path} 
            title={item.displayName}
            onClose={() => handleStopClick()}
            subtitleSettings={subtitleSettings}
          />
        ) : (
          <PlayButton
            onClick={handlePlayClick}
            hasSubtitles={subtitleInfo && subtitleInfo.length > 0}
            viewMode={viewMode}
            filePath={item.path}
          />
        )}
      </div>
      

      <div className={viewMode === 'list' ? 'flex-1' : ''}>
        <div className="flex items-center gap-3 mb-2">
          <Film className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-semibold text-white">{item.displayName}</h3>
          {/* Show subtitle indicator only after checking */}
          {subtitleInfo && subtitleInfo.length > 0 && (
            <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded-full">
              📝 CC
            </span>
          )}
        </div>

        <div className="text-sm text-gray-400 mb-3">
          <p>Size: {item.sizeFormatted}</p>
          <p>Modified: {new Date(item.modified).toLocaleDateString()}</p>
          {subtitleInfo && subtitleInfo.length > 0 && <p>📝 Subtitles available</p>}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {tags.map(tag => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={toggleWatched}
            className={`flex items-center gap-2 px-3 py-1 rounded border transition-colors ${
              watched
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {watched ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            {watched ? 'Watched' : 'Mark Watched'}
          </button>

          <a
            href={downloadUrl}
            className="flex items-center gap-2 px-3 py-1 bg-gray-700 border border-gray-600 hover:bg-gray-600 rounded text-gray-300 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download
          </a>
        </div>

        <TagEditor
          filePath={item.path}
          currentTags={tags}
          onTagsChange={handleTagsChange}
        />
      </div>
    </div>
  );
}

// Main App component
export default function MediaBrowser() {
  const [currentPath, setCurrentPath] = useState('');
  const [data, setData] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name-asc');
  const [filterBy, setFilterBy] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [user, setUser] = useState(null);
  const [currentlyPlaying, setCurrentlyPlaying] = useState(null);
  const { apiCall, loading, error } = useApi();
  const [subtitleSettings, setSubtitleSettings] = useState({
    language: 'all', // Default to all languages
    enabled: true
  });
  const [showUploadModal, setShowUploadModal] = useState(false);


  // Load data
  const loadData = useCallback(async (path = '') => {
    try {
      const result = await apiCall(`/browse?path=${encodeURIComponent(path)}`);
      setData(result);
      setCurrentPath(path);
      console.log('loadData - setting currentPath to:', path); // DEBUG LOG
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  }, [apiCall]);

  // Load user info
  const loadUser = useCallback(async () => {
    try {
      const userData = await apiCall('/user');
      setUser(userData);
    } catch (error) {
      console.error('Failed to load user:', error);
    }
  }, [apiCall]);

  // Filter and sort items
  const filteredItems = useMemo(() => {
    if (!data) return [];

    let items = [...data.folders, ...data.files];

    // Filter by search term
    if (searchTerm) {
      items = items.filter(item => {
        const name = item.displayName || item.name;
        return name.toLowerCase().includes(searchTerm.toLowerCase()) ||
               (item.tags && item.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())));
      });
    }

    // Filter by type/tag
    if (filterBy) {
      if (filterBy === 'folders') {
        items = items.filter(item => item.type === 'folder');
      } else if (filterBy === 'files') {
        items = items.filter(item => item.type === 'file');
      } else if (filterBy === 'watched') {
        items = items.filter(item => item.watched);
      } else if (filterBy === 'unwatched') {
        items = items.filter(item => item.type === 'file' && !item.watched);
      } else {
        items = items.filter(item => item.tags && item.tags.includes(filterBy));
      }
    }

    // Sort items
    items.sort((a, b) => {
      const [field, order] = sortBy.split('-');
      let comparison = 0;

      // Folders first unless sorting by size
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

    return items;
  }, [data, searchTerm, filterBy, sortBy]);

  // Stats
  const stats = useMemo(() => {
    const folders = filteredItems.filter(item => item.type === 'folder').length;
    const files = filteredItems.filter(item => item.type === 'file').length;
    const watched = filteredItems.filter(item => item.watched).length;
    const totalSize = filteredItems.reduce((sum, item) => sum + (item.size || 0), 0);
    const sizeGB = (totalSize / 1024 / 1024 / 1024).toFixed(1);

    return { folders, files, watched, totalSize: sizeGB };
  }, [filteredItems]);

  // Initialize
  useEffect(() => {
    loadUser();
    loadData();
  }, [loadUser, loadData]);

  const handleNavigate = (path) => {
    setCurrentPath(path);
    console.log('Navigating to path:', path); // DEBUG LOG
    setCurrentlyPlaying(null); // Stop any playing video when navigating
    loadData(path);
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-red-400 text-xl">Error: {error}</div>
      </div>
    );
  }
  const handleUploadComplete = () => {
    // Refresh the current directory to show new files
    loadData(currentPath);
  };
  const handleOpenUpload = () => {
    if (data) { // Only open if data is loaded
      setShowUploadModal(true);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      {/* Header */}
      <div className="text-center mb-8 p-6 bg-gray-800 rounded-lg">
        <h1 className="text-3xl font-bold mb-4">📁 Media Server</h1>
        {user && (
          <div className="text-gray-300">
            <p>Welcome, {user.username}</p>
            <p className="mt-2">
              <Lock className="inline w-4 h-4 mr-1" />
              Secure Connection
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      {data && (
        <Breadcrumbs 
          breadcrumbs={data.breadcrumbs} 
          onNavigate={handleNavigate} 
        />
      )}

      {/* Controls */}
      {data && (
        <Controls
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          sortBy={sortBy}
          onSortChange={setSortBy}
          filterBy={filterBy}
          onFilterChange={setFilterBy}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          allTags={data.allTags || []}
          subtitleSettings={subtitleSettings}
          onSubtitleSettingsChange={setSubtitleSettings}
        />
      )}

      {/* Stats */}
      <div className="text-center text-gray-400 mb-6">
        Showing {stats.folders} folders and {stats.files} files
        {stats.watched > 0 && ` • ${stats.watched} watched`}
        {stats.totalSize > 0 && ` • ${stats.totalSize} GB total`}
      </div>

      {/* Content */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-gray-400 text-xl">No items found</div>
        </div>
      ) : (
        <div className={
          viewMode === 'grid' 
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6'
            : 'space-y-4'
        }>
          {filteredItems.map((item, index) => (
            <MediaItem
              key={`${item.type}-${item.path}-${index}`}
              item={item}
              viewMode={viewMode}
              onNavigate={handleNavigate}
              isPlaying={currentlyPlaying === item.path}
              onPlayToggle={(path, shouldPlay) => {
                if (shouldPlay) {
                  setCurrentlyPlaying(path);
                } else {
                  setCurrentlyPlaying(null);
                }
              }}
              subtitleSettings={subtitleSettings}
            />
          ))}
        </div>
      )}
      {/* Upload Modal */}
      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        data={data} 
        onUploadComplete={handleUploadComplete}
      />
      
      {/* Floating Upload Button */}
      {data && (
        <FloatingUploadButton
          onClick={() => setShowUploadModal(true)}
        />
      )}
    </div>
  );
}