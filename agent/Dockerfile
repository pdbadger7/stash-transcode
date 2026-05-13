FROM node:20-alpine

WORKDIR /app

# Install ffmpeg and other utilities
RUN apk add --no-cache ffmpeg curl

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Build
RUN npm run build

# Run
EXPOSE 8080

CMD ["npm", "start"]
