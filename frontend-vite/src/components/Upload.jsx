import React, { useState, useRef } from 'react';
import { 
  Plus,
  Upload,
  FolderPlus,
  X,
  CheckCircle,
  Home,
  ChevronRight
} from 'lucide-react';
import { useApi, API_BASE } from '../utils/Api'; // Assuming you have a custom hook for API calls

// Add this Upload Modal component before the main App component
function UploadModal({ isOpen, onClose, data, onUploadComplete }) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [newDirName, setNewDirName] = useState('');
  const [showCreateDir, setShowCreateDir] = useState(false);
  const fileInputRef = useRef(null);
  const { apiCall } = useApi();

  const currentPath = data?.breadcrumbs ? 
    data.breadcrumbs[data.breadcrumbs.length - 1]?.path || '' : '';
  
  const currentLocationName = data?.breadcrumbs ? 
    data.breadcrumbs[data.breadcrumbs.length - 1]?.name || 'Home' : 'Home';

//   console.log('Upload Modal - Current path from breadcrumbs:', currentPath);
//   console.log('Upload Modal - Current location name:', currentLocationName);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files);
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      handleFileUpload(files);
    }
  };

  const handleFileUpload = async (files) => {
    setUploading(true);
    setUploadProgress(files.map(f => ({ name: f.name, progress: 0, status: 'pending' })));

    try {
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });
      formData.append('currentPath', currentPath);
    //   console.log('Uploading files:', files, 'to path:', currentPath);

      // Create XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          setUploadProgress(prev => 
            prev.map(item => ({ ...item, progress: percentComplete, status: 'uploading' }))
          );
        }
      });

      const response = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(`Upload failed: ${xhr.statusText}`));
          }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        
        xhr.open('POST', `${API_BASE}/upload`);
        xhr.setRequestHeader('Authorization', 'Basic ' + btoa('vamshi:abe124')); // You might need to handle auth differently
        xhr.send(formData);
      });

      setUploadProgress(prev => 
        prev.map(item => ({ ...item, progress: 100, status: 'completed' }))
      );

      setTimeout(() => {
        onUploadComplete();
        onClose();
        setUploadProgress([]);
      }, 1000);

    } catch (error) {
      console.error('Upload failed:', error);
      setUploadProgress(prev => 
        prev.map(item => ({ ...item, status: 'error' }))
      );
    } finally {
      setUploading(false);
    }
  };

  const handleCreateDirectory = async () => {
    if (!newDirName.trim()) return;

    try {
      await apiCall('/create-directory', {
        method: 'POST',
        body: JSON.stringify({
          directoryName: newDirName,
          currentPath: currentPath
        })
      });

      setNewDirName('');
      setShowCreateDir(false);
      onUploadComplete();
      onClose();
    } catch (error) {
      console.error('Failed to create directory:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg border border-gray-600 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-600">
          <h2 className="text-xl font-semibold text-white">Upload Files & Folders</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
            {/* ENHANCED CURRENT PATH DISPLAY WITH DEBUGGING */}
            <div className="bg-gray-700 rounded-lg p-3 border border-gray-600">
            <div className="text-sm text-gray-300 mb-2">Uploading to:</div>
            
            {/* Show breadcrumb path visually */}
            <div className="flex items-center gap-2 text-green-400 flex-wrap">
              {data?.breadcrumbs?.map((crumb, index) => (
                <React.Fragment key={`${crumb.path}-${index}`}>
                  {index > 0 && <ChevronRight className="w-3 h-3 text-gray-500" />}
                  <span className={`${
                    index === data.breadcrumbs.length - 1 
                      ? 'font-semibold text-green-300 bg-green-900 px-2 py-1 rounded' 
                      : 'text-gray-400'
                  }`}>
                    {index === 0 ? (
                      <span className="flex items-center gap-1">
                        <Home className="w-3 h-3" />
                        {crumb.name}
                      </span>
                    ) : (
                      crumb.name
                    )}
                  </span>
                </React.Fragment>
              ))}
            </div>
            
            {/* Show technical path for debugging */}
            <div className="text-xs text-gray-500 mt-1">
              System path: /{currentPath || 'root'}
            </div>
          </div>
            
          {/* Current Path */}
          <div className="text-sm text-gray-400">
            Uploading to: <span className="text-green-400">/{currentPath || 'Home'}</span>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 rounded-lg text-white transition-colors"
            >
              <Upload className="w-4 h-4" />
              Select Files
            </button>
            
            <button
              onClick={() => setShowCreateDir(!showCreateDir)}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded-lg text-white transition-colors"
            >
              <FolderPlus className="w-4 h-4" />
              New Folder
            </button>
          </div>

          {/* Create Directory Form */}
          {showCreateDir && (
            <div className="bg-gray-700 rounded-lg p-4 border border-gray-600">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDirName}
                  onChange={(e) => setNewDirName(e.target.value)}
                  placeholder="Enter folder name..."
                  className="flex-1 px-3 py-2 bg-gray-600 border border-gray-500 rounded text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                  onKeyPress={(e) => e.key === 'Enter' && handleCreateDirectory()}
                />
                <button
                  onClick={handleCreateDirectory}
                  disabled={!newDirName.trim()}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 rounded text-white transition-colors"
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {/* Drag & Drop Area */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive
                ? 'border-green-500 bg-green-500 bg-opacity-10'
                : 'border-gray-600 bg-gray-700'
            } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-white mb-2">Drag and drop files here</p>
            <p className="text-gray-400 text-sm">
              Supports video files, images, and other media
            </p>
          </div>

          {/* Upload Progress */}
          {uploadProgress.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-white">Upload Progress</h3>
              {uploadProgress.map((file, index) => (
                <div key={index} className="bg-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-white truncate">{file.name}</span>
                    <div className="flex items-center gap-2">
                      {file.status === 'completed' && (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      )}
                      <span className="text-xs text-gray-400">
                        {Math.round(file.progress)}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-600 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        file.status === 'error'
                          ? 'bg-red-500'
                          : file.status === 'completed'
                          ? 'bg-green-500'
                          : 'bg-blue-500'
                      }`}
                      style={{ width: `${file.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            accept="video/*,audio/*,image/*"
          />
        </div>
      </div>
    </div>
  );
}

// Add this floating action button component
function FloatingUploadButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 w-14 h-14 bg-green-600 hover:bg-green-500 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-40"
      title="Upload files or create folder"
    >
      <Plus className="w-6 h-6" />
    </button>
  );
}

export { UploadModal, FloatingUploadButton };