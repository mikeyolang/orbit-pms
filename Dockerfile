FROM node:22-alpine AS application

WORKDIR /app

RUN npm install --global npm@11.16.0

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ARG VITE_APP_URL=http://pms.helapay.africa
ENV VITE_APP_URL=$VITE_APP_URL
ENV NITRO_PRESET=node_server

RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
