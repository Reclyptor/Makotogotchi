# Stage 1: Build the Remix app
FROM node:20.5.1-alpine AS builder

WORKDIR /app

COPY . .

RUN npm install && npm run build

# Stage 2: Run the built app on a minimal Alpine image
FROM alpine:latest

WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

RUN apk add --no-cache npm

EXPOSE 80

ENV PORT=80

CMD ["npx", "@remix-run/serve", "build/server/index.js"]