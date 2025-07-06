#!/bin/bash

echo "Setting up single-service media server..."

# 1. Stop any existing services
launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.frontend.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.backend.plist 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.plist 2>/dev/null

# 2. Frontend is already built (we did this in previous step)
echo "✅ Frontend already built"

# 3. Add static serving to backend if not already present
cd /Users/battalavamshi/mediaserver/backend

if ! grep -q "express.static.*frontend-vite/dist" server.js; then
    echo "Adding static file serving to backend..."
    
    # Create a backup
    cp server.js server.js.backup
    
    # Find the line with app.listen and insert before it
    sed -i '' '/app\.listen/i\
// Serve React build files\
app.use(express.static(path.join(__dirname, '\''../frontend-vite/dist'\'')));\
\
// Serve React app for all non-API routes (must be last)\
app.get('\''*'\'', (req, res) => {\
  if (!req.path.startsWith('\''/api'\'')) {\
    res.sendFile(path.join(__dirname, '\''../frontend-vite/dist/index.html'\''));\
  } else {\
    res.status(404).json({ error: '\''API endpoint not found'\'' });\
  }\
});\
' server.js
    
    echo "✅ Added static file serving to backend"
else
    echo "✅ Static file serving already configured"
fi

# 4. Create single LaunchAgent
echo "Creating single LaunchAgent..."
cat > ~/Library/LaunchAgents/com.vamshi.mediaserver.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.vamshi.mediaserver</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-di</string>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/battalavamshi/mediaserver/backend/server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Users/battalavamshi/mediaserver/backend</string>
    <key>StandardOutPath</key>
    <string>/tmp/mediaserver.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mediaserver.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
EOF

# 5. Clean up old service files
rm -f ~/Library/LaunchAgents/com.vamshi.mediaserver.frontend.plist
rm -f ~/Library/LaunchAgents/com.vamshi.mediaserver.backend.plist

# 6. Test manually first
echo "Testing backend with static serving..."
cd /Users/battalavamshi/mediaserver/backend
timeout 5s node server.js &
SERVER_PID=$!
sleep 3

echo -n "Testing API: "
if curl -s http://localhost:3001/api/user > /dev/null; then
    echo "✅"
else
    echo "❌"
fi

echo -n "Testing React app: "
if curl -s http://localhost:3001 | grep -q "Media Server" 2>/dev/null; then
    echo "✅"
else
    echo "❌"
fi

kill $SERVER_PID 2>/dev/null
sleep 1

# 7. Load the service
echo "Loading single service..."
launchctl load ~/Library/LaunchAgents/com.vamshi.mediaserver.plist

# 8. Wait and check
sleep 5
echo ""
echo "Service Status:"
launchctl list | grep com.vamshi.mediaserver

echo ""
echo "Testing final setup..."
echo -n "Backend + Frontend: "
if curl -s http://localhost:3001 > /dev/null; then
    echo "✅ Running on http://localhost:3001"
else
    echo "❌ Failed"
    echo "Check logs: tail -f /tmp/mediaserver.error.log"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Your media server is now available at:"
echo "  🌐 http://localhost:3001"
echo ""
echo "Logs:"
echo "  📋 tail -f /tmp/mediaserver.log"
echo "  ❌ tail -f /tmp/mediaserver.error.log"
echo ""
echo "Control:"
echo "  🛑 launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.plist"
echo "  ▶️  launchctl load ~/Library/LaunchAgents/com.vamshi.mediaserver.plist"