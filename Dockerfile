FROM node:18-alpine

WORKDIR /app

# Install system dependencies for PDF generation
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create storage directory
RUN mkdir -p storage

# Expose port (if API server is used)
EXPOSE 3000

# Default command (can be overridden)
CMD ["npm", "start"]
