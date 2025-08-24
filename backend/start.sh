#!/bin/bash
# Startar både Node-backenden och Flask-API:t

echo "🔄 Startar Flask-backend på port 5001..."
python3 planera-api.py &

echo "🚀 Startar Node-backend på port 3001..."
node index.js
