#!/bin/bash
# save as dev-setup.sh

echo "Setting up development environment..."

# Kill any existing processes on the ports
echo "Cleaning up existing processes..."
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:3444 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

# Start frontend dev server with hot reload
echo "Starting frontend dev server..."
cd frontend-vite
npm run dev &
FRONTEND_PID=$!

# Wait a moment for frontend to start
sleep 3

# Start backend
echo "Starting backend server..."
cd ../backend  # adjust path to your backend directory
node server.js &
BACKEND_PID=$!

echo "🚀 Development servers started!"
echo "📱 Frontend (with hot reload): http://localhost:5173"
echo "🔧 Backend API: http://localhost:3001"
echo "🔒 Backend HTTPS: https://localhost:3444"
echo ""
echo "Press Ctrl+C to stop all servers"

# Handle cleanup on script termination
trap "echo 'Stopping servers...'; kill $FRONTEND_PID $BACKEND_PID 2>/dev/null; exit" INT TERM

# Wait for processes
wait