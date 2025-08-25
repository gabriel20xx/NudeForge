# NudeForge Dockerfile
FROM node:lts-slim
WORKDIR /app
ARG NPM_TOKEN
ENV NODE_ENV=production PORT=8080

COPY package*.json ./
RUN if [ -n "$NPM_TOKEN" ]; then \
			npm config set @gabriel20xx:registry https://npm.pkg.github.com && \
			npm config set //npm.pkg.github.com/:_authToken "$NPM_TOKEN" ; \
		fi && \
		(npm ci --omit=dev || npm install --omit=dev)

COPY . .

# Copy shared theme from the installed package into app's public css
RUN node -e "const p=require('path'),fs=require('fs');const dir=p.dirname(require.resolve('@gabriel20xx/nude-shared/package.json'));fs.mkdirSync('src/public/css',{recursive:true});fs.copyFileSync(p.join(dir,'theme.css'),'src/public/css/theme.css')"

# Basic container health check hitting /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "require('http').get('http://localhost:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

EXPOSE 8080
CMD ["npm", "start"]
