FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --legacy-peer-deps
RUN npx prisma generate
COPY . .
EXPOSE 3000
CMD ["node_modules/.bin/nest", "start", "--watch"]
