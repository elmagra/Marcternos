const fs = require('fs-extra');
const path = require('path');
const config = require('../config/config');

function nowIso() {
  return new Date().toISOString();
}

function normalizePathKey(p) {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function slugifyName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'instance';
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

async function ensureRegistryDir() {
  await fs.ensureDir(path.dirname(config.INSTANCE_REGISTRY_PATH));
  await fs.ensureDir(config.SERVERS_ROOT);
}

async function readRegistry() {
  await ensureRegistryDir();
  if (!await fs.pathExists(config.INSTANCE_REGISTRY_PATH)) {
    return { activeInstanceId: null, instances: [] };
  }
  const data = await fs.readJson(config.INSTANCE_REGISTRY_PATH).catch(() => ({ activeInstanceId: null, instances: [] }));
  if (!data || typeof data !== 'object') return { activeInstanceId: null, instances: [] };
  if (!Array.isArray(data.instances)) data.instances = [];
  return data;
}

async function writeRegistry(registry) {
  await ensureRegistryDir();
  await fs.writeJson(config.INSTANCE_REGISTRY_PATH, registry, { spaces: 2 });
}

function normalizeInstance(instance) {
  if (!instance) return null;
  return {
    id: String(instance.id),
    name: String(instance.name || instance.id),
    path: String(instance.path),
    software: String(instance.software || 'Vanilla'),
    version: String(instance.version || '...'),
    status: String(instance.status || 'offline'),
    createdAt: instance.createdAt || nowIso(),
    updatedAt: instance.updatedAt || nowIso()
  };
}

async function discoverFoldersAsInstances() {
  await fs.ensureDir(config.SERVERS_ROOT);
  const entries = await fs.readdir(config.SERVERS_ROOT).catch(() => []);
  const folders = [];
  for (const entry of entries) {
    if (String(entry).startsWith('.')) continue;
    const fullPath = path.join(config.SERVERS_ROOT, entry);
    const st = await fs.stat(fullPath).catch(() => null);
    if (!st || !st.isDirectory()) continue;

    // Evita registrar carpetas "a medias" durante create-world.
    const creatingLockPath = path.join(fullPath, '.creating');
    if (await fs.pathExists(creatingLockPath)) continue;

    const hasProps = await fs.pathExists(path.join(fullPath, 'server.properties'));
    const hasJar = await fs.pathExists(path.join(fullPath, 'server.jar'));
    if (!hasProps || !hasJar) continue;

    folders.push({ name: entry, path: fullPath });
  }
  return folders;
}

async function ensureRegistryMigrated() {
  const registry = await readRegistry();
  const folders = await discoverFoldersAsInstances();

  if (registry.instances.length === 0 && folders.length > 0) {
    registry.instances = folders.map((f, idx) => normalizeInstance({
      id: idx === 0 ? config.DEFAULT_INSTANCE_ID : `${slugifyName(f.name)}-${randomSuffix()}`,
      name: f.name,
      path: f.path,
      software: 'Vanilla',
      version: '...',
      status: 'offline',
      createdAt: nowIso(),
      updatedAt: nowIso()
    }));
    registry.activeInstanceId = registry.instances[0].id;
    await writeRegistry(registry);
    return registry;
  }

  let changed = false;

  // No autodescubrimos carpetas nuevas cuando ya hay registry:
  // evita "instancias fantasma" durante creaciones parciales/races.

  // Limpia entradas cuyo path ya no existe físicamente.
  if (registry.instances.length > 0) {
    const kept = [];
    for (const inst of registry.instances) {
      const st = await fs.stat(inst.path).catch(() => null);
      if (st && st.isDirectory()) kept.push(inst);
    }
    if (kept.length !== registry.instances.length) {
      registry.instances = kept;
      changed = true;
    }
  }

  if (!registry.activeInstanceId && registry.instances.length > 0) {
    registry.activeInstanceId = registry.instances[0].id;
    changed = true;
  }

  // Deduplicar instancias por ruta (prioriza IDs no "default")
  if (registry.instances.length > 1) {
    const byPath = new Map();
    for (const inst of registry.instances) {
      const key = normalizePathKey(inst.path);
      const prev = byPath.get(key);
      if (!prev) {
        byPath.set(key, inst);
        continue;
      }
      if (prev.id === config.DEFAULT_INSTANCE_ID && inst.id !== config.DEFAULT_INSTANCE_ID) {
        byPath.set(key, inst);
      }
    }
    const deduped = Array.from(byPath.values());
    if (deduped.length !== registry.instances.length) {
      registry.instances = deduped;
      if (!registry.instances.some(i => i.id === registry.activeInstanceId)) {
        registry.activeInstanceId = registry.instances[0] ? registry.instances[0].id : null;
      }
      changed = true;
    }
  }

  if (changed) await writeRegistry(registry);
  return registry;
}

async function listInstances() {
  const registry = await ensureRegistryMigrated();
  return registry.instances;
}

async function getActiveInstanceId() {
  const registry = await ensureRegistryMigrated();
  return registry.activeInstanceId || null;
}

async function setActiveInstance(instanceId) {
  const registry = await ensureRegistryMigrated();
  const instance = registry.instances.find(i => i.id === instanceId);
  if (!instance) return null;
  registry.activeInstanceId = instance.id;
  await writeRegistry(registry);
  return instance;
}

async function getInstanceById(instanceId) {
  if (!instanceId) return null;
  const registry = await ensureRegistryMigrated();
  return registry.instances.find(i => i.id === instanceId) || null;
}

async function getActiveInstance() {
  const registry = await ensureRegistryMigrated();
  return registry.instances.find(i => i.id === registry.activeInstanceId) || registry.instances[0] || null;
}

async function registerInstance({ id, name, path: instancePath, software, version, status }) {
  const registry = await ensureRegistryMigrated();
  const finalId = id || `${slugifyName(name)}-${randomSuffix()}`;
  const finalPath = instancePath || path.join(config.SERVERS_ROOT, name);
  const normalizedPath = normalizePathKey(finalPath);

  if (registry.instances.some(i => i.id === finalId)) {
    throw new Error(`Ya existe una instancia con id ${finalId}`);
  }

  const existingByPath = registry.instances.find(i => normalizePathKey(i.path) === normalizedPath);
  if (existingByPath) {
    // Si ya existe por ruta, actualiza metadatos para evitar quedarse en "Vanilla ..."
    existingByPath.name = String(name || existingByPath.name || existingByPath.id);
    existingByPath.software = String(software || existingByPath.software || 'Vanilla');
    existingByPath.version = String(version || existingByPath.version || '...');
    existingByPath.status = String(status || existingByPath.status || 'offline');
    existingByPath.updatedAt = nowIso();
    await writeRegistry(registry);
    return existingByPath;
  }

  const instance = normalizeInstance({
    id: finalId,
    name: name || finalId,
    path: finalPath,
    software: software || 'Vanilla',
    version: version || '...',
    status: status || 'offline',
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  registry.instances.push(instance);
  if (!registry.activeInstanceId) registry.activeInstanceId = instance.id;
  await writeRegistry(registry);
  return instance;
}

async function updateInstance(instanceId, patch) {
  const registry = await ensureRegistryMigrated();
  const idx = registry.instances.findIndex(i => i.id === instanceId);
  if (idx < 0) return null;

  registry.instances[idx] = normalizeInstance({
    ...registry.instances[idx],
    ...patch,
    updatedAt: nowIso()
  });

  await writeRegistry(registry);
  return registry.instances[idx];
}

async function removeInstance(instanceId) {
  const registry = await ensureRegistryMigrated();
  const idx = registry.instances.findIndex(i => i.id === instanceId);
  if (idx < 0) return null;

  const [removed] = registry.instances.splice(idx, 1);
  if (registry.activeInstanceId === instanceId) {
    registry.activeInstanceId = registry.instances[0] ? registry.instances[0].id : null;
  }
  await writeRegistry(registry);
  return removed;
}

module.exports = {
  listInstances,
  registerInstance,
  updateInstance,
  removeInstance,
  getInstanceById,
  getActiveInstance,
  getActiveInstanceId,
  setActiveInstance,
  ensureRegistryMigrated
};
