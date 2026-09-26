FROM node:20-slim

# fonts-dejavu-core: /verify captcha gorselindeki karakterler icin font.
RUN apt-get update && apt-get install -y python3 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]
