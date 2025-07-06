#!/bin/bash

echo "🔍 Debugging media server service..."

# 1. Check if service is loaded
echo "Checking service status..."
launchctl list | grep mediaserver

# 2. Check service file exists
if [ -f ~/Library/LaunchAgents/com.vamshi.mediaserver.plist ]; then
    echo "✅ Service file exists"
else
    echo "❌ Service file missing"
fi

# 3. Check for syntax errors in server.js
echo ""
echo "Checking server.js syntax..."
cd /Users/battalavamshi/mediaserver/backend
node -c server.js
if [ $? -eq 0 ]; then
    echo "✅ server.js syntax OK"
else
    echo "❌ server.js has syntax errors"
    exit 1
fi

# 4. Check if port is in use
echo ""
echo "Checking if port 3001 is in use..."
lsof -i :3001
if [ $? -eq 0 ]; then
    echo "⚠️  Port 3001 is already in use"
    echo "Killing existing processes..."
    lsof -ti :3001 | xargs kill -9 2>/dev/null
    sleep 2
else
    echo "✅ Port 3001 is free"
fi

# 5. Check logs
echo ""
echo "Recent service logs:"
if [ -f /tmp/mediaserver.log ]; then
    echo "--- Last 10 lines of /tmp/mediaserver.log ---"
    tail -10 /tmp/mediaserver.log
else
    echo "No log file found at /tmp/mediaserver.log"
fi

# 6. Try starting manually first
echo ""
echo "Testing manual start..."
cd /Users/battalavamshi/mediaserver/backend

# Start in background and capture PID
node server.js &
SERVER_PID=$!

# Wait a moment for server to start
sleep 3

# Test if it's responding
echo "Testing server response..."
if curl -s http://localhost:3001 > /dev/null; then
    echo "✅ Manual start successful!"
    
    # Kill the manual process
    kill $SERVER_PID 2>/dev/null
    
    # Now restart the service properly
    echo ""
    echo "Restarting service properly..."
    launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.plist 2>/dev/null
    sleep 2
    launchctl load ~/Library/LaunchAgents/com.vamshi.mediaserver.plist
    sleep 5
    
    # Test service
    if curl -s http://localhost:3001 > /dev/null; then
        echo "✅ Service started successfully!"
        
        # Test network access
        LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
        if curl -s http://$LOCAL_IP:3001 > /dev/null; then
            echo "✅ Network access working!"
            echo ""
            echo "🎉 All systems go!"
            echo "📱 Phone URL: http://$LOCAL_IP:3001"
        else
            echo "❌ Network access failed"
        fi
    else
        echo "❌ Service failed to start"
        echo "Checking service logs..."
        launchctl list | grep mediaserver
    fi
else
    echo "❌ Manual start failed"
    
    # Kill the process anyway
    kill $SERVER_PID 2>/dev/null
    
    echo ""
    echo "Checking for errors..."
    
    # Try to start and see immediate error
    timeout 10s node server.js || echo "Server failed to start within 10 seconds"
fi