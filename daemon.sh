#!/bin/bash

echo "Setting up network access for media server..."

# 1. Get current IP address
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "Unknown")
BONJOUR_NAME=$(scutil --get ComputerName 2>/dev/null || echo "blankmask")

echo "Network Information:"
echo "  Local IP: $LOCAL_IP"
echo "  Bonjour: $BONJOUR_NAME.local"
echo ""

# 2. Stop current service
echo "Stopping current service..."
launchctl unload ~/Library/LaunchAgents/com.vamshi.mediaserver.plist 2>/dev/null

# 3. Rebuild frontend to ensure latest code
echo "Rebuilding frontend..."
cd /Users/battalavamshi/mediaserver/frontend-vite
npm run build

# 4. Update CORS in backend
echo "Updating CORS configuration..."
cd /Users/battalavamshi/mediaserver/backend

# Backup current server.js
cp server.js server.js.backup.$(date +%Y%m%d_%H%M%S)

# Replace CORS configuration
sed -i '' '/const corsOptions = {/,/};/c\
const corsOptions = {\
    origin: function (origin, callback) {\
        if (!origin) return callback(null, true);\
        if (origin.includes("localhost") || origin.includes("127.0.0.1")) {\
            return callback(null, true);\
        }\
        if (origin.includes("blankmask.local")) {\
            return callback(null, true);\
        }\
        const localNetworkRegex = /^https?:\/\/(192\\.168\\.|10\\.|172\\.16\\.|172\\.17\\.|172\\.18\\.|172\\.19\\.|172\\.2[0-9]\\.|172\\.3[0-1]\\.)/;\
        if (localNetworkRegex.test(origin)) {\
            return callback(null, true);\
        }\
        return callback(null, true);\
    },\
    credentials: true,\
    optionsSuccessStatus: 200,\
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],\
    allowedHeaders: ["Content-Type", "Authorization", "Range"]\
};' server.js

echo "✅ Updated CORS configuration"

# 5. Restart service
echo "Restarting service..."
launchctl load ~/Library/LaunchAgents/com.vamshi.mediaserver.plist

# 6. Wait for service to start
sleep 5

# 7. Test local access
echo ""
echo "Testing access..."
echo -n "Local access: "
if curl -s http://localhost:3001 > /dev/null; then
    echo "✅"
else
    echo "❌"
fi

echo -n "Network access: "
if curl -s http://$LOCAL_IP:3001 > /dev/null; then
    echo "✅"
else
    echo "❌"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Access your media server from:"
echo "  📱 Phone: http://$LOCAL_IP:3001"
echo "  🖥️  Computer: http://localhost:3001"
echo "  🌐 Bonjour: http://$BONJOUR_NAME.local:3001"
echo ""
echo "Test these URLs in your phone's browser!"
echo ""
echo "Credentials:"
echo "  Username: blankmask"
echo "  Password: helloworld"