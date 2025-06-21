# Usa a imagem base do Node.js
FROM node:18-alpine

# Define o diretório de trabalho
WORKDIR /app

# 1. Copia APENAS o package.json primeiro
COPY package.json ./

# 2. Limpeza radical de cache + instalação forçada
RUN rm -rf node_modules && \
    rm -rf /root/.npm && \
    npm install --force

# 3. Copia o resto do projeto
COPY . .

# Expõe a porta
EXPOSE 3000

# Inicia a aplicação
CMD ["node", "server.js"]
