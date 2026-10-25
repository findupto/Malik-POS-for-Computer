FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN npm install --omit=dev --no-audit --no-fund pg@^8.16.3
COPY server/index.mjs server/schema.sql server/syncPolicy.mjs server/sessionClaims.mjs server/quantity.mjs server/loginRateLimit.mjs ./server/
EXPOSE 8787
CMD ["node", "server/index.mjs"]
