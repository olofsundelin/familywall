FROM node:20-bookworm-slim AS nodebase
WORKDIR /app

# 1) Node deps (cachear så länge package*.json inte ändras)
COPY package*.json ./
RUN npm ci --only=production
RUN npm ci --omit=dev

# 2) Python deps (cachear så länge requirements.txt inte ändras)
FROM python:3.11-slim AS pydeps
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# 3) Runtime – inga apt-get i onödan
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# Lägg till cert-hantering här vid behov

# Kopiera in färdiga deps-lager
COPY --from=nodebase /app/node_modules /app/node_modules
COPY --from=pydeps /usr/local/lib/python3.11 /usr/local/lib/python3.11
COPY --from=pydeps /usr/local/bin /usr/local/bin

# Koden mountas i prod via compose-volymen /opt/familywall/backend:/app
# Men ha gärna en default CMD som funkar utan mount:
COPY . .
COPY docker/install-ca.sh /usr/local/bin/install-ca
RUN chmod +x /usr/local/bin/install-ca
CMD ["node", "index.js"]
