#!/bin/bash

echo "🔧 Fixing video file permissions for transcoding..."

MEDIA_ROOT="/Volumes/VAMSHI/VAMSHI/"

if [ ! -d "$MEDIA_ROOT" ]; then
    echo "❌ Media root directory not found: $MEDIA_ROOT"
    exit 1
fi

echo "Media root: $MEDIA_ROOT"
echo "Current user: $(whoami)"
echo ""

# 1. Check current permissions on a few files
echo "Sample current permissions:"
find "$MEDIA_ROOT" -name "*.mkv" -o -name "*.avi" -o -name "*.mp4" | head -5 | while read file; do
    ls -la "$file"
done

echo ""

# 2. Fix permissions for video files
echo "Fixing permissions for video files..."
echo "This will make files readable by the server process..."

# Make video files readable by owner and group
find "$MEDIA_ROOT" -type f \( -name "*.mkv" -o -name "*.avi" -o -name "*.mp4" -o -name "*.mov" -o -name "*.wmv" -o -name "*.flv" -o -name "*.webm" -o -name "*.m4v" \) -exec chmod 644 {} \;

echo "✅ Video file permissions updated"

# 3. Fix directory permissions
echo "Fixing directory permissions..."
find "$MEDIA_ROOT" -type d -exec chmod 755 {} \;

echo "✅ Directory permissions updated"

# 4. Verify changes
echo ""
echo "Verifying changes - sample permissions after fix:"
find "$MEDIA_ROOT" -name "*.mkv" -o -name "*.avi" -o -name "*.mp4" | head -5 | while read file; do
    ls -la "$file"
done

echo ""

# 5. Test with the same file that failed before
TEST_FILE="/Volumes/VAMSHI/VAMSHI/anime and series/Arcane/Arcane_S01E01_Welcome_to_the_Playground_1080p_10bit_WEBRip_6CH_x265.mkv"

if [ -f "$TEST_FILE" ]; then
    echo "Testing transcoding with the previously failing file..."
    echo "File permissions now:"
    ls -la "$TEST_FILE"
    
    echo ""
    echo "Testing 5-second transcode..."
    
    # Test transcoding with the exact file that failed
    timeout 15s ffmpeg -i "$TEST_FILE" -t 5 \
        -c:v libx264 \
        -c:a aac \
        -preset veryfast \
        -crf 28 \
        -profile:v main \
        -level 4.0 \
        -pix_fmt yuv420p \
        -s 1280x720 \
        -b:v 1000k \
        -b:a 128k \
        -f mp4 \
        -y /tmp/permission_test.mp4 2>&1
    
    if [ -f /tmp/permission_test.mp4 ]; then
        FILE_SIZE=$(stat -f%z /tmp/permission_test.mp4 2>/dev/null || stat -c%s /tmp/permission_test.mp4 2>/dev/null)
        if [ "$FILE_SIZE" -gt 10000 ]; then
            echo "✅ Transcoding test SUCCESSFUL! Output size: $FILE_SIZE bytes"
            rm -f /tmp/permission_test.mp4
        else
            echo "❌ Transcoding produced empty/tiny file"
        fi
    else
        echo "❌ Transcoding still failing"
    fi
else
    echo "⚠️  Original test file not found, but permissions should be fixed"
fi

echo ""
echo "🎉 Permission fix complete!"
echo ""
echo "Now restart your media server:"
echo "  pkill -f 'node server.js'"
echo "  launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.plist"
echo "  launchctl load ~/Library/LaunchAgents/com.vamshi.mediaserver.plist"