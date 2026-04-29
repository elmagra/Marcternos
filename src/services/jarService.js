const axios = require('axios');

async function getJarUrl(type, ver) {
    if (type.toLowerCase().includes('paper')) {
        try {
            const buildData = await axios.get(`https://api.papermc.io/v2/projects/paper/versions/${ver}/builds`);
            const latestBuild = buildData.data.builds[buildData.data.builds.length - 1];
            const filename = latestBuild.downloads.application.name;
            return `https://api.papermc.io/v2/projects/paper/versions/${ver}/builds/${latestBuild.build}/downloads/${filename}`;
        } catch (e) {
            console.error("Error fetching PaperMC build:", e.message);
        }
    }

    // Fabric Installer (Optimized)
    if (type.toLowerCase().includes('fabric')) {
        // Usamos una URL directa al instalador o cargador estable para la versión
        return `https://meta.fabricmc.net/v2/versions/loader/${ver}/0.19.2/1.0.1/server/jar`;
    }
    
    // Official Mojang Vanilla mappings
    const vanillaMapping = {
        '1.21.1': 'https://piston-data.mojang.com/v1/objects/59353fb40c36d304f2035d51e7d6e6baa98dc05c/server.jar',
        '1.21': 'https://piston-data.mojang.com/v1/objects/cf35b909f2efa5ea5a64804e4823a7541a97a18a/server.jar',
        '1.20.6': 'https://piston-data.mojang.com/v1/objects/145ff0858209bcfc164859ba735d4199aafa1eea/server.jar',
        '1.20.4': 'https://piston-data.mojang.com/v1/objects/5eca988f7f81276d741cbd50f39b65193c4451a1/server.jar',
        '1.20.1': 'https://piston-data.mojang.com/v1/objects/84194a2f286ef7c14ed7ce0090dba59902951553/server.jar',
        '1.19.4': 'https://piston-data.mojang.com/v1/objects/fcebdddaa0fc8c62d5ce2087adde9ed844f7d7d6/server.jar',
        '1.16.5': 'https://piston-data.mojang.com/v1/objects/fba9f7833e858a1257d810d21a3a9e3c967f9077/server.jar',
        '1.12.2': 'https://launcher.mojang.com/v1/objects/88624534f36da7496c1482813589999a8449e755/server.jar'
    };
    
    if (vanillaMapping[ver]) return vanillaMapping[ver];
}

module.exports = {
    getJarUrl
};

