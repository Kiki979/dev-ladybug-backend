# Nutze das offizielle Node.js-Image mit Alpine als Basis
FROM node:22-alpine

# Setze das Arbeitsverzeichnis im Container
WORKDIR /app

# Installiere benötigte Abhängigkeiten für node-gyp und sqlite3
RUN apk add --no-cache python3 py3-pip make g++ sqlite

# Kopiere die package.json und package-lock.json in den Container
COPY package.json  ./

# Installiere npm-Abhängigkeiten (einschließlich sqlite3)
RUN npm install --build-from-source sqlite3

# Kopiere den restlichen Code ins Arbeitsverzeichnis
COPY . .

# Exponiere den Port, auf dem dein Chat-Server läuft
EXPOSE 3001

# Starte die Anwendung
CMD ["node", "server.js"]
