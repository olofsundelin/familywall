cat > ~/familywall/backend/gunicorn.conf.py <<'EOF'
bind = "0.0.0.0:5001"
workers = 3
timeout = 600
graceful_timeout = 30
keepalive = 5
EOF
