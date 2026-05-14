FROM node:24-alpine

WORKDIR /app

# Install ffmpeg and other utilities
RUN apk add --no-cache --update-cache\
	aom-dev \
	chromaprint-dev \
	cunit-dev \
	fdk-aac-dev \
	ffmpeg \
  ffmpeg-libs \
	ffmpeg-dev \
  flite-dev \
	fontconfig-dev \
	freetype-dev \
	frei0r-plugins-dev \
  curl \
	fribidi-dev \
	gsm-dev \
	jack-dev \
	lame-dev \
	libass-dev \
	libbluray-dev \
	libcaca-dev \
	libcdio-dev \
	libcdio-paranoia-dev \
	libdc1394-dev \
	libdrm-dev \
	libogg-dev \
	libpng-dev \
	librsvg-dev \
	libsndfile-dev \
	libssh-dev \
	libtheora-dev \
	libvorbis-dev \
	libvpx-dev \
	libwebp-dev \
	libxau-dev \
	libxcb-dev \
	libxml2-dev \
	mesa-dev \
	mpg123-dev \
	openjpeg-dev \
	openal-soft-dev \
	openssl-dev \
	opus-dev \
	pulseaudio-dev \
	sdl2-dev \
	snappy-dev \
	soxr-dev \
	speex-dev \
	util-linux-dev \
	wavpack-dev \
	x264-dev \
	x265-dev \
	xvidcore-dev \
	zeromq-dev \
	\
	libva-dev \
  libva-utils \
	libva-intel-driver \
	libvdpau-dev \
	mesa-va-gallium \
	mesa-vdpau-gallium

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
