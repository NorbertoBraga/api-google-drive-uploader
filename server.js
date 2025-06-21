// server.js - API Intermediária para Upload no Google Drive
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração de CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Função auxiliar para extrair o token OAuth2
function extractAccessToken(req) {
  // Verifica o header Authorization
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Verifica se o N8N enviou as credenciais de outra forma
  if (req.headers['x-goog-authenticated-user-oauth2']) {
    return req.headers['x-goog-authenticated-user-oauth2'];
  }
  
  return null;
}

// Rota principal de upload
app.post('/upload', async (req, res) => {
  console.log('=== Nova requisição de upload ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  try {
    // 1. Extrair o token de acesso
    const accessToken = extractAccessToken(req);
    
    if (!accessToken) {
      console.error('Token não encontrado nos headers');
      return res.status(401).json({
        error: 'Invalid Credentials',
        details: [{
          message: 'No access token provided',
          domain: 'global',
          reason: 'authError',
          location: 'Authorization',
          locationType: 'header'
        }]
      });
    }
    
    console.log('Token encontrado:', accessToken.substring(0, 20) + '...');
    
    // 2. Configurar autenticação OAuth2
    const auth = new google.auth.OAuth2();
    auth.setCredentials({
      access_token: accessToken
    });
    
    // 3. Criar cliente do Google Drive
    const drive = google.drive({ version: 'v3', auth });
    
    // 4. Extrair informações do request
    const { filePath, fileName, folderId, mimeType } = req.body;
    
    if (!filePath) {
      return res.status(400).json({
        error: 'Bad Request',
        details: [{
          message: 'filePath is required',
          domain: 'global',
          reason: 'required',
          location: 'filePath',
          locationType: 'parameter'
        }]
      });
    }
    
    console.log(`Tentando fazer upload do arquivo: ${filePath}`);
    
    // 5. Verificar se o arquivo existe
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'File Not Found',
        details: [{
          message: `File not found: ${filePath}`,
          domain: 'global',
          reason: 'notFound',
          location: 'filePath',
          locationType: 'parameter'
        }]
      });
    }
    
    // 6. Preparar metadados do arquivo
    const fileMetadata = {
      name: fileName || path.basename(filePath),
      mimeType: mimeType || 'video/mp4'
    };
    
    // Se um folderId foi fornecido, adicionar aos metadados
    if (folderId && folderId !== 'root') {
      fileMetadata.parents = [folderId];
    }
    
    // 7. Criar stream do arquivo
    const media = {
      mimeType: fileMetadata.mimeType,
      body: fs.createReadStream(filePath)
    };
    
    console.log('Iniciando upload para o Google Drive...');
    console.log('Metadados:', fileMetadata);
    
    // 8. Fazer upload
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink, mimeType, size'
    });
    
    console.log('Upload concluído com sucesso!');
    console.log('Resposta:', response.data);
    
    // 9. Retornar resposta no formato esperado pelo N8N
    res.json({
      file: {
        id: response.data.id,
        name: response.data.name,
        webViewLink: response.data.webViewLink,
        webContentLink: response.data.webContentLink,
        mimeType: response.data.mimeType,
        size: response.data.size
      }
    });
    
  } catch (error) {
    console.error('Erro durante o upload:', error);
    
    // Tratar erros específicos do Google
    if (error.response && error.response.data && error.response.data.error) {
      const googleError = error.response.data.error;
      
      // Token expirado ou inválido
      if (googleError.code === 401) {
        return res.status(401).json({
          error: 'Invalid Credentials',
          details: googleError.errors || [{
            message: 'The access token is expired or invalid',
            domain: 'global',
            reason: 'authError',
            location: 'Authorization',
            locationType: 'header'
          }]
        });
      }
      
      // Outros erros do Google
      return res.status(error.response.status || 500).json({
        error: googleError.message || 'Google Drive API Error',
        details: googleError.errors || []
      });
    }
    
    // Erro genérico
    res.status(500).json({
      error: 'Internal Server Error',
      details: [{
        message: error.message || 'An unexpected error occurred',
        domain: 'global',
        reason: 'internalError'
      }]
    });
  }
});

// Rota de teste para verificar se a API está funcionando
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Rota para testar autenticação
app.post('/test-auth', async (req, res) => {
  try {
    const accessToken = extractAccessToken(req);
    
    if (!accessToken) {
      return res.status(401).json({ error: 'No access token provided' });
    }
    
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    
    const drive = google.drive({ version: 'v3', auth });
    
    // Tenta listar arquivos para verificar se o token é válido
    const response = await drive.files.list({
      pageSize: 1,
      fields: 'files(id, name)'
    });
    
    res.json({
      status: 'authenticated',
      message: 'Token is valid',
      testFile: response.data.files[0] || null
    });
    
  } catch (error) {
    res.status(401).json({
      error: 'Invalid token',
      details: error.message
    });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`API de Upload do Google Drive rodando na porta ${PORT}`);
  console.log(`Endpoints disponíveis:`);
  console.log(`  - POST /upload - Fazer upload de arquivo`);
  console.log(`  - GET /health - Verificar status da API`);
  console.log(`  - POST /test-auth - Testar autenticação`);
});