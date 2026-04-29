const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const { createReadStream } = require('fs');

const config = require('../config/config');

const BACKUPS_ROOT = process.env.BACKUPS_ROOT || path.join(__dirname, '../../data/backups');

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function generateBackupId() {
  return `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_\- ().]/g, '')
    .slice(0, 120) || 'backup';
}

function defaultBackupName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Backup ${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}h${pad(d.getMinutes())}m`;
}

/** Ensure the path is inside the allowed root (prevent path traversal) */
function assertSafePath(root, target) {
  const resolved = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new Error('Ruta no permitida (path traversal detectado)');
  }
}

// ─── Metadata persistence ───────────────────────────────────────────────────

function metadataPath(instanceId) {
  return path.join(BACKUPS_ROOT, instanceId, 'backups-meta.json');
}

async function readMeta(instanceId) {
  const fp = metadataPath(instanceId);
  if (!await fs.pathExists(fp)) return [];
  const data = await fs.readJson(fp).catch(() => []);
  return Array.isArray(data) ? data : [];
}

async function writeMeta(instanceId, backups) {
  const fp = metadataPath(instanceId);
  await fs.ensureDir(path.dirname(fp));
  await fs.writeJson(fp, backups, { spaces: 2 });
}

// ─── Core functions ─────────────────────────────────────────────────────────

/**
 * Create a backup of the entire server instance folder.
 * @param {string} instanceId
 * @param {string} serverPath - absolute path to the server folder
 * @param {object} opts - { name, description }
 * @returns {Promise<object>} backup metadata
 */
async function createBackup(instanceId, serverPath, opts = {}) {
  if (!instanceId || !serverPath) throw new Error('instanceId y serverPath son obligatorios');
  if (!await fs.pathExists(serverPath)) throw new Error('La carpeta del servidor no existe');

  const id = generateBackupId();
  const name = sanitizeName(opts.name) || defaultBackupName();
  const description = String(opts.description || '').trim().slice(0, 500);
  const backupDir = path.join(BACKUPS_ROOT, instanceId);
  await fs.ensureDir(backupDir);

  const zipName = `${id}.zip`;
  const zipPath = path.join(backupDir, zipName);

  // Create zip
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 5 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.on('warning', (w) => { 
      if (w.code === 'ENOENT') {
        console.warn('[BACKUP-WARN] Archivo no encontrado al comprimir:', w.message);
        return;
      }
      if (w.code === 'EPERM' || w.code === 'EBUSY') {
        console.warn('[BACKUP-WARN] Saltando archivo bloqueado por el sistema:', w.message);
        return;
      }
      reject(w); 
    });

    archive.pipe(output);
    archive.directory(serverPath, false);
    archive.finalize();
  });

  const stats = await fs.stat(zipPath);
  const backup = {
    id,
    name,
    instanceId,
    description,
    zipPath,
    size: stats.size,
    sizeFormatted: formatBytes(stats.size),
    createdAt: nowIso(),
    status: 'created' // created | restored | error | auto-pre-restore
  };

  const backups = await readMeta(instanceId);
  backups.unshift(backup);
  await writeMeta(instanceId, backups);

  return backup;
}

/**
 * List all backups for a given instance.
 */
async function listBackups(instanceId) {
  if (!instanceId) return [];
  const backups = await readMeta(instanceId);
  // Verificar que los archivos zip existen aún
  const valid = [];
  for (const b of backups) {
    if (await fs.pathExists(b.zipPath)) {
      const st = await fs.stat(b.zipPath).catch(() => null);
      if (st) {
        b.size = st.size;
        b.sizeFormatted = formatBytes(st.size);
      }
      valid.push(b);
    }
  }
  if (valid.length !== backups.length) await writeMeta(instanceId, valid);
  return valid;
}

/**
 * Get details of a specific backup.
 */
async function getBackup(instanceId, backupId) {
  const backups = await readMeta(instanceId);
  return backups.find(b => b.id === backupId) || null;
}

/**
 * Delete a backup.
 */
async function deleteBackup(instanceId, backupId) {
  const backups = await readMeta(instanceId);
  const idx = backups.findIndex(b => b.id === backupId);
  if (idx < 0) throw new Error('Backup no encontrado');
  const backup = backups[idx];
  if (await fs.pathExists(backup.zipPath)) {
    await fs.remove(backup.zipPath);
  }
  backups.splice(idx, 1);
  await writeMeta(instanceId, backups);
  return backup;
}

/**
 * Rename / update description of a backup.
 */
async function updateBackup(instanceId, backupId, patch) {
  const backups = await readMeta(instanceId);
  const backup = backups.find(b => b.id === backupId);
  if (!backup) throw new Error('Backup no encontrado');
  if (patch.name !== undefined) backup.name = sanitizeName(patch.name);
  if (patch.description !== undefined) backup.description = String(patch.description).trim().slice(0, 500);
  await writeMeta(instanceId, backups);
  return backup;
}

/**
 * Restore a backup: creates an auto-backup of current state, then replaces the server folder.
 * @param {string} instanceId
 * @param {string} backupId
 * @param {string} serverPath - absolute path to the server folder
 * @returns {Promise<{ autoBackup: object, restored: object }>}
 */
async function restoreBackup(instanceId, backupId, serverPath) {
  const backup = await getBackup(instanceId, backupId);
  if (!backup) throw new Error('Backup no encontrado');
  if (!await fs.pathExists(backup.zipPath)) throw new Error('El archivo zip del backup no existe');

  // 1. Auto-backup del estado actual
  let autoBackup = null;
  try {
    autoBackup = await createBackup(instanceId, serverPath, {
      name: `[Auto] Pre-restauración ${new Date().toLocaleString('es-ES')}`,
      description: `Backup automático creado antes de restaurar "${backup.name}"`
    });
    // Mark the auto-backup
    const backups = await readMeta(instanceId);
    const ab = backups.find(b => b.id === autoBackup.id);
    if (ab) ab.status = 'auto-pre-restore';
    await writeMeta(instanceId, backups);
  } catch (e) {
    console.error('[BACKUP] Error creando auto-backup pre-restauración:', e.message);
    // No bloquear la restauración por un fallo en el auto-backup
  }

  // 2. Limpiar carpeta del servidor
  const items = await fs.readdir(serverPath);
  for (const item of items) {
    await fs.remove(path.join(serverPath, item));
  }

  // 3. Extraer backup
  await extractZip(backup.zipPath, serverPath);

  // 4. Actualizar estado
  const allBackups = await readMeta(instanceId);
  const restored = allBackups.find(b => b.id === backupId);
  if (restored) restored.status = 'restored';
  await writeMeta(instanceId, allBackups);

  return { autoBackup, restored };
}

/**
 * Extract a zip file to a directory using a child process (cross-platform).
 */
async function extractZip(zipPath, destDir) {
  const { exec } = require('child_process');
  const os = require('os');

  await fs.ensureDir(destDir);

  return new Promise((resolve, reject) => {
    let cmd;
    if (os.platform() === 'win32') {
      // PowerShell Expand-Archive
      cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`;
    } else {
      cmd = `unzip -o "${zipPath}" -d "${destDir}"`;
    }

    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Error al extraer zip: ${stderr || err.message}`));
      else resolve();
    });
  });
}

/**
 * Get the zip file path for download.
 */
function getBackupFilePath(backup) {
  return backup ? backup.zipPath : null;
}

/**
 * Create a zip from a folder (for folder download in file manager).
 */
async function zipFolder(folderPath, outputPath) {
  await fs.ensureDir(path.dirname(outputPath));
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 5 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(folderPath, path.basename(folderPath));
    archive.finalize();
  });
}

/**
 * Validate a zip file contains Minecraft world data (level.dat).
 */
async function validateWorldZip(zipPath) {
  const { exec } = require('child_process');
  const os = require('os');

  return new Promise((resolve) => {
    let cmd;
    if (os.platform() === 'win32') {
      cmd = `powershell -NoProfile -Command "(New-Object System.IO.Compression.ZipArchive([System.IO.File]::OpenRead('${zipPath.replace(/'/g, "''")}'))).Entries | ForEach-Object { $_.FullName } | Select-String 'level.dat'"`;
    } else {
      cmd = `unzip -l "${zipPath}" | grep "level.dat"`;
    }

    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout || !stdout.includes('level.dat')) {
        resolve({ valid: false, reason: 'El archivo zip no contiene level.dat. No parece ser un mundo de Minecraft válido.' });
      } else {
        resolve({ valid: true });
      }
    });
  });
}

module.exports = {
  BACKUPS_ROOT,
  createBackup,
  listBackups,
  getBackup,
  deleteBackup,
  updateBackup,
  restoreBackup,
  extractZip,
  getBackupFilePath,
  zipFolder,
  validateWorldZip,
  formatBytes,
  sanitizeName,
  assertSafePath
};
