FROM node:20-bookworm-slim
WORKDIR /app

COPY docker/install-ca.sh /usr/local/bin/install-ca
RUN chmod +x /usr/local/bin/install-ca

COPY shopping-app/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY shopping-app ./

RUN node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts.build?0:42)" \
  && npm run build || echo 'No build script – skip'

RUN npm i -g serve
ENV PORT=8081
EXPOSE 8081
CMD ["sh","-lc","(test -d dist && serve -s dist -l $PORT) || (test -d build && serve -s build -l $PORT) || serve -s . -l $PORT"]
