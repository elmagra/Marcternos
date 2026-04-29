const axios = require('axios');
axios.get('https://meta.fabricmc.net/v2/versions/loader').then(res => {
    const stable = res.data.filter(v => v.stable);
    console.log(stable.slice(0, 5).map(v => v.version).join('\n'));
}).catch(console.error);
