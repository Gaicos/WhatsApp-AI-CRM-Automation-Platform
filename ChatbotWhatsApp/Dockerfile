FROM node:22-alpine

RUN apk add --no-cache tzdata
ENV TZ=America/Sao_Paulo

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY . .

RUN mkdir -p data midia auth_info

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
