#!/bin/sh
set -e

# Enkel CA-installation som funkar i både Debian/Ubuntu och Alpine
if [ -f /certs/ca.crt ]; then
  echo "[certs] Installerar root CA från /certs/ca.crt"

  # För Debian/Ubuntu (update-ca-certificates letar i /usr/local/share/ca-certificates/*.crt)
  if [ -d /usr/local/share/ca-certificates ]; then
    cp /certs/ca.crt /usr/local/share/ca-certificates/local-ca.crt || true
  fi

  # För RHEL/CentOS (fallback om du nånsin byter basimage)
  if [ -d /etc/pki/ca-trust/source/anchors ]; then
    cp /certs/ca.crt /etc/pki/ca-trust/source/anchors/local-ca.crt || true
  fi

  # Alpine/Debian
  if command -v update-ca-certificates >/dev/null 2>&1; then
    update-ca-certificates
  elif command -v update-ca-trust >/dev/null 2>&1; then
    update-ca-trust extract
  else
    # sista utväg: append till bundle om den finns
    if [ -f /etc/ssl/certs/ca-certificates.crt ]; then
      cat /certs/ca.crt >> /etc/ssl/certs/ca-certificates.crt || true
    fi
  fi

  echo "[certs] CA installerat. Startar app..."
else
  echo "[certs] Ingen /certs/ca.crt hittad. Startar app..."
fi

exec "$@"
