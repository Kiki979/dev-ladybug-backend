FROM node:20-bullseye

# Setze Arbeitsverzeichnis
WORKDIR /app

# Sicherheitsupdates + Systemabhängigkeiten installieren
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
  python3 \
  make \
  g++ \
  sqlite3 \
  && rm -rf /var/lib/apt/lists/*

# Dependencies installieren
COPY package.json ./
RUN npm install --build-from-source sqlite3

# Restliche Dateien
COPY . .

# Ports öffnen
EXPOSE 3001 443

# Startbefehl
CMD ["node", "server.js"]
