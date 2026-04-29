var serverData = {
  name: "Minecraft Server Demo",
  status: "online",
  uptimeSeconds: 12240,
  cpu: 37,
  ramUsed: 4.6,
  ramTotal: 8,
  diskUsed: 26,
  diskTotal: 50,
  tps: 19.8,
  world: "world",
  worldSize: 1.4,
  maxPlayers: 20,

  settings: {
    difficulty: "normal",
    gamemode: "survival",
    viewDistance: 10,
    pvp: true,
    whitelist: true,
    nether: true,
    commandBlocks: false,
    keepInventory: false,
    spawnMonsters: true
  },

  logs: [
    "Servidor iniciado correctamente.",
    "Steve123 entró al servidor.",
    "MinerMax murió en una explosión.",
    "AlexPro cambió al Nether."
  ],

  players: [
    {
      id: 1,
      name: "Steve123",
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      ip: "192.168.1.45",

      online: true,
      op: true,
      whitelisted: true,

      bannedIp: false,
      bannedUuid: false,

      gamemode: "Survival",
      dimension: "Overworld",

      health: 18,
      hunger: 16,
      xp: 34,
      level: 18,

      location: { x: 124, y: 65, z: -342 },
      spawn: { x: 0, y: 64, z: 0 },
      lastDeath: { x: 100, y: 62, z: -300 },

      inventory: ["Espada", "Pico", "Pan"],
      enderChest: ["Diamante"],

      stats: {
        deaths: 2,
        kills: 14,
        playTime: "12h 45m"
      }
    },

    {
      id: 2,
      name: "AlexPro",
      uuid: "c1a8b6d2-6f2d-42f4-99f0-121212121212",
      ip: "192.168.1.50",

      online: false,
      op: false,
      whitelisted: true,

      bannedIp: false,
      bannedUuid: false,

      gamemode: "Creative",
      dimension: "Nether",

      health: 20,
      hunger: 20,
      xp: 10,
      level: 5,

      location: { x: -52, y: 70, z: 210 },
      spawn: { x: 0, y: 64, z: 0 },
      lastDeath: { x: -40, y: 68, z: 200 },

      inventory: ["Bloques", "Antorchas"],
      enderChest: [],

      stats: {
        deaths: 1,
        kills: 3,
        playTime: "5h 10m"
      }
    },

    {
      id: 3,
      name: "MinerMax",
      uuid: "987e6543-e29b-41d4-a716-446655441111",
      ip: "192.168.1.60",

      online: true,
      op: false,
      whitelisted: false,

      bannedIp: false,
      bannedUuid: false,

      gamemode: "Survival",
      dimension: "Overworld",

      health: 12,
      hunger: 10,
      xp: 60,
      level: 27,

      location: { x: 230, y: 12, z: -600 },
      spawn: { x: 0, y: 64, z: 0 },
      lastDeath: { x: 200, y: 11, z: -580 },

      inventory: ["Hierro", "Carbón"],
      enderChest: ["Oro"],

      stats: {
        deaths: 6,
        kills: 8,
        playTime: "23h 02m"
      }
    },

    {
      id: 4,
      name: "IpBannedPlayer",
      uuid: "11111111-2222-3333-4444-555555555555",
      ip: "192.168.1.77",

      online: false,
      op: false,
      whitelisted: false,

      bannedIp: true,
      bannedUuid: false,

      gamemode: "Survival",
      dimension: "Overworld",

      health: 20,
      hunger: 20,
      xp: 0,
      level: 0,

      location: { x: 0, y: 64, z: 0 },
      spawn: { x: 0, y: 64, z: 0 },
      lastDeath: { x: 0, y: 64, z: 0 },

      inventory: [],
      enderChest: [],

      stats: {
        deaths: 0,
        kills: 0,
        playTime: "1h 20m"
      }
    },

    {
      id: 5,
      name: "UuidBannedPlayer",
      uuid: "aaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ip: "192.168.1.88",

      online: false,
      op: false,
      whitelisted: false,

      bannedIp: false,
      bannedUuid: true,

      gamemode: "Survival",
      dimension: "Nether",

      health: 20,
      hunger: 20,
      xp: 0,
      level: 0,

      location: { x: 0, y: 64, z: 0 },
      spawn: { x: 0, y: 64, z: 0 },
      lastDeath: { x: 0, y: 64, z: 0 },

      inventory: [],
      enderChest: [],

      stats: {
        deaths: 0,
        kills: 0,
        playTime: "2h 12m"
      }
    },

    {
      id: 6,
      name: "FullyBanned",
      uuid: "ffffffff-1111-2222-3333-444444444444",
      ip: "192.168.1.99",

      online: false,
      op: false,
      whitelisted: false,

      bannedIp: true,
      bannedUuid: true,

      gamemode: "Survival",
      dimension: "End",

      health: 20,
      hunger: 20,
      xp: 0,
      level: 0,

      location: { x: 0, y: 64, z: 0 },
      spawn: { x: 0, y: 64, z: 0 },
      lastDeath: { x: 0, y: 64, z: 0 },

      inventory: [],
      enderChest: [],

      stats: {
        deaths: 0,
        kills: 0,
        playTime: "3h 00m"
      }
    }
  ]
};
