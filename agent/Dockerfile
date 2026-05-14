FROM node:24-alpine

WORKDIR /app

# Install ffmpeg and other utilities
RUN apk add --no-cache \
  ffmpeg \
  mesa-va-gallium \
  intel-media-driver \
  libva-intel-driver \
  libva-utils \
  curl

# Copy root package files (for workspace setup)
COPY package.json package-lock.json ./

# Copy agent package.json
COPY agent/package.json ./agent/

# Install dependencies (includes agent via workspace)
RUN npm install

# Copy agent source
COPY agent/src ./agent/src
COPY agent/tsconfig.json ./agent/

# Build agent
RUN npm -w stash-transcode-agent run build

# Set working directory to agent dist
WORKDIR /app/agent

# Expose and run from root for npm start to work
EXPOSE 8080

CMD ["npm", "start"]
