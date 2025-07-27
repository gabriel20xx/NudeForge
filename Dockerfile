# Use official Node.js runtime as base image
FROM node:18-alpine

# Install dependencies needed for Sharp
RUN apk add --no-cache \
    libc6-compat \
    libvips-dev

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Rebuild Sharp for the container platform
RUN npm rebuild sharp

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p public/img/carousel/thumbnails

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
