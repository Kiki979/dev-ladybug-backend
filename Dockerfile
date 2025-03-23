# Nutze das offizielle Node.js-Image mit Alpine als Basis
FROM node:22-alpine

# Setze das Arbeitsverzeichnis im Container
WORKDIR /app

# Installiere systemweite Abhängigkeiten
RUN apk add --no-cache python3 make g++ sqlite

# Kopiere nur das Nötigste zum Installieren
COPY package.json ./

# Installiere alle npm-Abhängigkeiten
RUN npm install --build-from-source sqlite3

# Kopiere den restlichen Quellcode ins Image
COPY . .

# Setze Umgebungsvariable für Node (optional, z. B. für Produktionsmodus)
ENV NODE_ENV=production

# Exponiere den HTTP-Port
EXPOSE 3001

# Starte die Anwendung
CMD ["node", "server.js"]
