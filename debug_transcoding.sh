#!/bin/bash

echo "🔍 Deep debugging transcoding issues..."

TEST_FILE="/Volumes/VAMSHI/VAMSHI/anime and series/Arcane/Arcane_S01E01_Welcome_to_the_Playground_1080p_10bit_WEBRip_6CH_x265.mkv"

if [ ! -f "$TEST_FILE" ]; then
    echo "❌ Test file not found"
    exit 1
fi

echo "Test file: $TEST_FILE"
echo ""

# 1. Get detailed file information
echo "=== DETAILED FILE INFO ==="
ffprobe -v quiet -print_format json -show_format -show_streams "$TEST_FILE" | head -50

echo ""
echo "=== SIMPLIFIED FILE INFO ==="
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,bit_rate,duration -of csv=p=0 "$TEST_FILE"

echo ""

# 2. Try the most basic transcode
echo "=== TEST 1: Basic transcode (no special options) ==="
timeout 10s ffmpeg -i "$TEST_FILE" -t 3 -y /tmp/basic_test.mp4 2>&1 | tail -10

if [ -f /tmp/basic_test.mp4 ]; then
    SIZE=$(stat -f%z /tmp/basic_test.mp4 2>/dev/null || stat -c%s /tmp/basic_test.mp4 2>/dev/null)
    echo "✅ Basic transcode works! Size: $SIZE bytes"
    rm -f /tmp/basic_test.mp4
else
    echo "❌ Basic transcode failed"
fi

echo ""

# 3. Try with copy codec (no re-encoding)
echo "=== TEST 2: Stream copy (no re-encoding) ==="
timeout 10s ffmpeg -i "$TEST_FILE" -t 3 -c copy -y /tmp/copy_test.mp4 2>&1 | tail -10

if [ -f /tmp/copy_test.mp4 ]; then
    SIZE=$(stat -f%z /tmp/copy_test.mp4 2>/dev/null || stat -c%s /tmp/copy_test.mp4 2>/dev/null)
    echo "✅ Stream copy works! Size: $SIZE bytes"
    rm -f /tmp/copy_test.mp4
else
    echo "❌ Stream copy failed"
fi

echo ""

# 4. Try with minimal encoding options
echo "=== TEST 3: Minimal encoding ==="
timeout 15s ffmpeg -i "$TEST_FILE" -t 3 -c:v libx264 -c:a aac -preset ultrafast -y /tmp/minimal_test.mp4 2>&1 | tail -10

if [ -f /tmp/minimal_test.mp4 ]; then
    SIZE=$(stat -f%z /tmp/minimal_test.mp4 2>/dev/null || stat -c%s /tmp/minimal_test.mp4 2>/dev/null)
    echo "✅ Minimal encoding works! Size: $SIZE bytes"
    rm -f /tmp/minimal_test.mp4
else
    echo "❌ Minimal encoding failed"
fi

echo ""

# 5. Try the exact command that was failing
echo "=== TEST 4: Exact failing command ==="
timeout 15s ffmpeg -i "$TEST_FILE" -t 3 \
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
    -y /tmp/exact_test.mp4

if [ -f /tmp/exact_test.mp4 ]; then
    SIZE=$(stat -f%z /tmp/exact_test.mp4 2>/dev/null || stat -c%s /tmp/exact_test.mp4 2>/dev/null)
    echo "✅ Exact command works! Size: $SIZE bytes"
    rm -f /tmp/exact_test.mp4
else
    echo "❌ Exact command failed"
fi

echo ""

# 6. Try with a different MKV file
echo "=== TEST 5: Different MKV file ==="
OTHER_MKV=$(find "/Volumes/VAMSHI/VAMSHI/" -name "*.mkv" -not -path "*Arcane*" | head -1)

if [ -n "$OTHER_MKV" ]; then
    echo "Testing with: $OTHER_MKV"
    timeout 10s ffmpeg -i "$OTHER_MKV" -t 3 -c:v libx264 -c:a aac -preset ultrafast -y /tmp/other_test.mp4 2>&1 | tail -5
    
    if [ -f /tmp/other_test.mp4 ]; then
        SIZE=$(stat -f%z /tmp/other_test.mp4 2>/dev/null || stat -c%s /tmp/other_test.mp4 2>/dev/null)
        echo "✅ Other MKV works! Size: $SIZE bytes"
        rm -f /tmp/other_test.mp4
    else
        echo "❌ Other MKV also failed"
    fi
else
    echo "No other MKV files found for testing"
fi

echo ""

# 7. Check for 10-bit video issues
echo "=== CHECKING FOR 10-BIT ISSUES ==="
echo "This video appears to be 10-bit (from filename). Let's check:"
ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt "$TEST_FILE"

echo ""
echo "=== TEST 6: Force 8-bit conversion ==="
timeout 15s ffmpeg -i "$TEST_FILE" -t 3 \
    -c:v libx264 \
    -c:a aac \
    -preset ultrafast \
    -pix_fmt yuv420p \
    -profile:v baseline \
    -y /tmp/force_8bit_test.mp4 2>&1 | tail -10

if [ -f /tmp/force_8bit_test.mp4 ]; then
    SIZE=$(stat -f%z /tmp/force_8bit_test.mp4 2>/dev/null || stat -c%s /tmp/force_8bit_test.mp4 2>/dev/null)
    echo "✅ Force 8-bit works! Size: $SIZE bytes"
    rm -f /tmp/force_8bit_test.mp4
else
    echo "❌ Force 8-bit failed"
fi

echo ""
echo "🔧 Debug complete! Check which tests passed above."