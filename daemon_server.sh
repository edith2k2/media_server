#!/bin/bash

# === SETUP LAUNCHAGENTS FOR MEDIA SERVER ===

# 1. First, build the frontend for production
echo "Building frontend for production..."
cd /Users/battalavamshi/mediaserver/frontend-vite
npm run build

# 2. Remove old LaunchAgent if it exists
echo "Removing old LaunchAgent..."
launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.vamshi.mediaserver.plist

# 3. Create the new LaunchAgent files
echo "Creating backend LaunchAgent..."
cat > ~/Library/LaunchAgents/com.vamshi.mediaserver.backend.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.vamshi.mediaserver.backend</string>
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
    <string>/tmp/mediaserver-backend.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mediaserver-backend.error.log</string>
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

echo "Creating frontend LaunchAgent..."
cat > ~/Library/LaunchAgents/com.vamshi.mediaserver.frontend.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.vamshi.mediaserver.frontend</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-di</string>
        <string>/opt/homebrew/bin/node</string>
        <string>/opt/homebrew/bin/npm</string>
        <string>run</string>
        <string>preview</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Users/battalavamshi/mediaserver/frontend-vite</string>
    <key>StandardOutPath</key>
    <string>/tmp/mediaserver-frontend.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mediaserver-frontend.error.log</string>
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

# 4. Load the new LaunchAgents
echo "Loading backend LaunchAgent..."
launchctl load ~/Library/LaunchAgents/com.vamshi.mediaserver.backend.plist

echo "Loading frontend LaunchAgent..."
launchctl load ~/Library/LaunchAgents/com.vamshi.mediaserver.frontend.plist

# 5. Check status
echo "Checking LaunchAgent status..."
launchctl list | grep com.vamshi.mediaserver

echo "Setup complete!"
echo ""
echo "Services will now auto-start on boot:"
echo "- Backend API: http://localhost:3001"
echo "- Frontend: http://localhost:4173 (Vite preview mode)"
echo ""
echo "Log files:"
echo "- Backend: /tmp/mediaserver-backend.log"
echo "- Frontend: /tmp/mediaserver-frontend.log"
echo ""
echo "To check logs:"
echo "  tail -f /tmp/mediaserver-backend.log"
echo "  tail -f /tmp/mediaserver-frontend.log"
echo ""
echo "To stop services:"
echo "  launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.backend.plist"
echo "  launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.frontend.plist"