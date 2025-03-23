FROM node:22-alpine

WORKDIR /app

# Install system deps
RUN apk add --no-cache \
  python3 \
  py3-pip \
  py3-setuptools \
  make \
  g++ \
  sqlite

# Optional: symlink "python" if needed
RUN ln -sf python3 /usr/bin/python

# Kopiere und installiere dependencies
COPY package.json ./
RUN npm install --build-from-source sqlite3

# Restliche Dateien kopieren
COPY . .

EXPOSE 3001 443

CMD ["node", "server.js"]
