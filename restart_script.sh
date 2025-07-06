#!/bin/bash

echo "🔄 Restarting media server..."

# 1. Kill all existing processes
echo "Stopping all existing processes..."
pkill -f "node server.js" 2>/dev/null
lsof -ti :3001 | xargs kill -9 2>/dev/null
lsof -ti :3444 | xargs kill -9 2>/dev/null

# Also stop the launchd service
launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.plist 2>/dev/null

echo "Waiting for ports to be released..."
sleep 3

# 2. Verify ports are free
echo "Checking port status..."
if lsof -i :3001 >/dev/null 2>&1; then
    echo "❌ Port 3001 still in use"
    lsof -i :3001
    exit 1
else
    echo "✅ Port 3001 is free"
fi

if lsof -i :3444 >/dev/null 2>&1; then
    echo "❌ Port 3444 still in use"
    lsof -i :3444
    exit 1
else
    echo "✅ Port 3444 is free"
fi

# 3. Test the fixed server.js syntax
echo "Testing server.js syntax..."
cd /Users/battalavamshi/mediaserver/backend
node -c server.js
if [ $? -ne 0 ]; then
    echo "❌ server.js has syntax errors - fix them first"
    exit 1
fi
echo "✅ Syntax OK"

# 4. Start server manually first to test
echo ""
echo "Starting server manually for testing..."
timeout 10s node server.js &
SERVER_PID=$!

# Wait for server to start
sleep 5

# 5. Test if it's working
echo "Testing server response..."
if curl -s http://localhost:3001/api/user >/dev/null 2>&1; then
    echo "✅ Server is responding!"
    
    # Kill manual process
    kill $SERVER_PID 2>/dev/null
    wait $SERVER_PID 2>/dev/null
    
    # 6. Start as service
    echo ""
    echo "Starting as service..."
    launchctl load ~/Library/LaunchAgents/com.vamshi.mediaserver.plist
    sleep 5
    
    # 7. Final test
    if curl -s http://localhost:3001/api/user >/dev/null 2>&1; then
        echo "✅ Service is running!"
        
        # Get IP and test network access
        LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
        echo ""
        echo "🎉 Success! Your server is running:"
        echo "  📱 Phone: http://$LOCAL_IP:3001"
        echo "  🖥️  Local: http://localhost:3001"
        echo "  🌐 Bonjour: http://blankmask.local:3001"
        echo ""
        echo "Test on your phone now!"
        echo "Login: blankmask / helloworld"
        
    else
        echo "❌ Service failed to start"
        echo "Check logs: tail -f /tmp/mediaserver.log"
    fi
    
else
    echo "❌ Server failed to start manually"
    echo "Killing test process..."
    kill $SERVER_PID 2>/dev/null
    
    echo ""
    echo "Let's see what the error is:"
    echo "Running server in foreground..."
    node server.js
fi