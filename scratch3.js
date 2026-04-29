const https = require('https');
const fs = require('fs');

https.get('https://api.modrinth.com/v2/project/fabric-api/version?game_versions=[%2226.1.2%22]', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const versions = JSON.parse(data);
            if (versions.length === 0) {
                console.log("No fabric-api found for 26.1.2");
                return;
            }
            const latest = versions[0];
            const file = latest.files.find(f => f.primary) || latest.files[0];
            console.log("Downloading", file.url);
            
            const fileStream = fs.createWriteStream('data/servers/nn-kb154s/mods/fabric-api.jar');
            https.get(file.url, (res2) => {
                res2.pipe(fileStream);
                res2.on('end', () => console.log('Downloaded!'));
            });
        } catch(e) {
            console.error("Error parsing response", data);
        }
    });
});
