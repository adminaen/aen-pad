FROM node:20-alpine

WORKDIR /app

# python3/make/g++ são necessários para compilar o binário nativo do
# better-sqlite3 durante o npm install.
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server.js"]
