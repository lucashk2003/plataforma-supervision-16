/*
 * server.js — Servidor principal de la Plataforma de Repositorio Documental
 * Supervisión 16 · Dirección General de Escuelas · Provincia de Mendoza
 *
 * Funciones principales:
 *  - Sirve las páginas HTML del frontend (carpeta /public)
 *  - Se conecta a Cloudflare R2 para listar los archivos por año
 *  - Genera links firmados temporales (5 minutos) para visualizar PDFs
 *    sin exponerlos públicamente
 *
 * Rutas disponibles:
 *  GET /api/archivos/:año  → lista los archivos de la carpeta del año indicado
 *  GET /api/ver/:año/:archivo → genera y redirige al link firmado del PDF
 *
 * Variables de entorno requeridas (archivo .env):
 *  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

require('dotenv').config();
const express = require('express');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

app.use(express.static('public'));

// Lista archivos de una carpeta
app.get('/api/archivos/:año', async (req, res) => {
  const año = req.params.año;
  const comando = new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET_NAME,
    Prefix: `${año}/`,
  });
  const datos = await s3.send(comando);
  const archivos = (datos.Contents || []).map(obj => obj.Key);
  res.json(archivos);
});

// Genera link firmado para un archivo
app.get('/api/ver/:año/:archivo', async (req, res) => {
  const { año, archivo } = req.params;
  const comando = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: `${año}/${archivo}`,
  });
  const url = await getSignedUrl(s3, comando, { expiresIn: 300 });
  res.redirect(url);
});

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));