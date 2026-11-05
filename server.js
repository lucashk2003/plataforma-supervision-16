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
 *  GET  /api/repositorios     → árbol de secciones y repositorios (repositorios.json)
 *  GET  /api/repositorio/:id  → archivos de R2 + metadatos del repositorio
 *  GET  /api/ver/:id/:archivo → genera y redirige al link firmado del PDF
 *
 * Los repositorios (carpeta de R2 + archivo de metadatos) se definen en
 * repositorios.json. Solo se aceptan ids que figuren allí.
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
const fs = require('fs');

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

// ---- Configuración de repositorios (ver repositorios.json) ----
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'repositorios.json'), 'utf-8'));
const repos = new Map(); // id -> repositorio (con su sección)
for (const sec of config.secciones) {
  for (const r of sec.repositorios) {
    repos.set(r.id, { ...r, seccion: sec.id, seccionTitulo: sec.titulo, emiteDefault: sec.emiteDefault || null });
  }
}

// Árbol para armar las páginas (no expone carpetas internas de R2)
app.get('/api/repositorios', (req, res) => {
  res.json(config.secciones.map(s => ({
    id: s.id,
    titulo: s.titulo,
    descripcion: s.descripcion || '',
    repositorios: s.repositorios.map(r => ({ id: r.id, titulo: r.titulo }))
  })));
});

// Lista todos los archivos de la carpeta (con paginación) y devuelve los metadatos
async function listarArchivos(prefijo) {
  const nombres = [];
  let token;
  do {
    const datos = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: `${prefijo}/`,
      ContinuationToken: token,
    }));
    for (const obj of datos.Contents || []) {
      const nombre = obj.Key.slice(prefijo.length + 1);
      if (nombre && !nombre.includes('/')) nombres.push(nombre); // ignora la carpeta y subcarpetas
    }
    token = datos.IsTruncated ? datos.NextContinuationToken : undefined;
  } while (token);
  return nombres;
}

function leerMetadatos(archivo) {
  if (!archivo) return {};
  try {
    const ruta = path.join(__dirname, 'public', path.basename(archivo));
    return JSON.parse(fs.readFileSync(ruta, 'utf-8'));
  } catch (error) {
    console.error(`No se pudieron leer los metadatos (${archivo}):`, error.message);
    return {};
  }
}

app.get('/api/repositorio/:id', async (req, res) => {
  const repo = repos.get(req.params.id);
  if (!repo) return res.status(404).send('Repositorio inexistente');
  try {
    res.json({
      id: repo.id,
      titulo: repo.titulo,
      seccion: repo.seccion,
      seccionTitulo: repo.seccionTitulo,
      emiteDefault: repo.emiteDefault,
      archivos: await listarArchivos(repo.prefijo),
      metadatos: leerMetadatos(repo.metadatos),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al listar archivos');
  }
});

app.get('/api/ver/:id/:archivo', async (req, res) => {
  const repo = repos.get(req.params.id);
  const archivo = req.params.archivo;
  if (!repo || archivo.includes('/') || archivo.includes('\\') || archivo.includes('..')) {
    return res.status(404).send('Archivo inexistente');
  }
  try {
    const comando = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: `${repo.prefijo}/${archivo}`,
    });
    const url = await getSignedUrl(s3, comando, { expiresIn: 300 });
    res.redirect(url);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al generar enlace');
  }
});

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));