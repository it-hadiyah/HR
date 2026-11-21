FROM node:22-slim
WORKDIR /app
# Chromium لتوليد ملفات PDF (تقارير نظام الأعضاء بتشكيل عربي سليم)
RUN apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 CHROME_PATH=/usr/bin/chromium
EXPOSE 3000
CMD ["node", "server/index.js"]
