/*
 * server.js — Servidor principal de la Plataforma de Repositorio Documental
 * Supervisión 16 · Dirección General de Escuelas · Provincia de Mendoza
 *
 * Funciones principales:
 *  - Sirve las páginas HTML del frontend (carpeta /public)
 *  - Gestiona el login y las sesiones de usuario
 *  - Se conecta a Cloudflare R2 para listar los archivos por año
 *  - Genera links firmados temporales (5 minutos) para visualizar PDFs
 *    sin exponerlos públicamente
 *
 * Rutas disponibles:
 *  POST /login                → valida usuario y contraseña
 *  GET  /logout               → cierra la sesión
 *  GET  /api/archivos/:año    → lista los archivos de la carpeta del año indicado
 *  GET  /api/ver/:año/:archivo → genera y redirige al link firmado del PDF
 *
 * Variables de entorno requeridas (archivo .env):
 *  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
 *  SESSION_SECRET, ADMIN_USER, ADMIN_PASS
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path'); // Importamos path para manejar rutas de archivos

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

// 1. Middlewares globales de parsing y sesión
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // sesión de 8 horas
}));

// 2. RUTAS PÚBLICAS (No requieren estar logueado)

// Servir la página de login de forma correcta
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// POST /login — procesa el formulario de login
app.post('/login', (req, res) => {
  console.log('Body recibido:', req.body);
  const { usuario, password } = req.body;
  if (usuario === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.logueado = true;
    res.redirect('/');
  } else {
    res.redirect('/login.html?error=1');
  }
});

// GET /logout — destruye la sesión
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// 3. MIDDLEWARE DE AUTENTICACIÓN
// Bloquea todo lo que se declare de acá para abajo si no hay sesión activa
function requireLogin(req, res, next) {
  if (req.session.logueado) return next();
  res.redirect('/login.html');
}

app.use(requireLogin);

// 4. RUTAS PRIVADAS (Solo accesibles después de pasar por requireLogin)
app.use(express.static('public')); // Sirve el resto de la web estática (index.html, etc.)

// API de archivos y visualización
app.get('/api/archivos/:año', async (req, res) => {
  try {
    const año = req.params.año;
    const comando = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: `${año}/`,
    });
    const datos = await s3.send(comando);
    const archivos = (datos.Contents || [])
      .map(obj => obj.Key)
      .filter(key => key !== `${año}/`);
    res.json(archivos);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al listar archivos');
  }
});

app.get('/api/ver/:año/:archivo', async (req, res) => {
  try {
    const { año, archivo } = req.params;
    const comando = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: `${año}/${archivo}`,
    });
    const url = await getSignedUrl(s3, comando, { expiresIn: 300 });
    res.redirect(url);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al generar enlace');
  }
});

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));