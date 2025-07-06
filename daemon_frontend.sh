#!/bin/bash

echo "Fixing Node.js version and updating LaunchAgent..."

# 1. Check current Node.js version
echo "Current Node.js version:"
node --version

# 2. Find Node.js path
NODE_PATH=$(which node)
echo "Node.js path: $NODE_PATH"

# 3. Stop existing service
launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.plist 2>/dev/null

# 4. Rebuild frontend with updated Node.js
echo "Rebuilding frontend..."
cd /Users/battalavamshi/mediaserver/frontend-vite
rm -rf node_modules package-lock.json
npm install
npm run build

if [ ! -d "dist" ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Frontend rebuilt successfully"

# 5. Update LaunchAgent with correct Node.js path
echo "Creating updated LaunchAgent..."
cat > ~/Library/LaunchAgents/com.vamshi.mediaserver.plist << EOF
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
        <string>$NODE_PATH</string>
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

# 6. Load the service
echo "Loading service..."
launchctl load ~/Library/LaunchAgents/com.vamshi.mediaserver.plist

# 7. Check status
sleep 3
echo ""
echo "Service status:"
launchctl list | grep com.vamshi.mediaserver

echo ""
echo "Testing service..."
if curl -s http://localhost:3001 > /dev/null; then
    echo "✅ Media server running at http://localhost:3001"
else
    echo "❌ Service failed to start"
    echo "Check logs: tail -f /tmp/mediaserver.error.log"
fi