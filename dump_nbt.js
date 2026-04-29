const fs = require('fs-extra');
const nbt = require('prismarine-nbt');
const path = require('path');

async function dump() {
    const file = process.argv[2];
    if (!file) return console.log('No file');
    const buf = await fs.readFile(file);
    const { parsed } = await nbt.parse(buf);
    const simple = nbt.simplify(parsed);
    console.log(JSON.stringify(simple, null, 2));
}
dump();
