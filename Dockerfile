FROM node:20-bullseye

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && apt-get install -y \
  python3 \
  make \
  g++ \
  sqlite3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./

# FORCE sqlite3 native build!
ENV npm_config_build_from_source=true

RUN npm install --build-from-source sqlite3

COPY . .

EXPOSE 3001 443

CMD ["node", "server.js"]
