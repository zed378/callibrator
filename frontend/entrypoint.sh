#!/bin/sh

# Start the compiled bun binary in the background
sh /usr/share/nginx/html/server > /tmp/server.log 2>&1 &
SERVER_PID=$!

# Wait for the server to be ready
echo "Waiting for Next.js server to start..."
for i in $(seq 1 60); do
  if kill -0 $SERVER_PID 2>/dev/null; then
    # Check if server is responding
    if wget -q -O - http://localhost:3000/ > /dev/null 2>&1; then
      echo "Next.js server is ready!"
      break
    fi
  fi
  if [ "$i" -eq 60 ]; then
    echo "Next.js server failed to start"
    echo "Server log:"
    cat /tmp/server.log
    exit 1
  fi
  sleep 1
done

# Start nginx in foreground
exec nginx -g "daemon off;"
