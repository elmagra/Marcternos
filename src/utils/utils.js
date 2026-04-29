const axios = require('axios');
const fs = require('fs-extra');

/**
 * Downloads a file with progress tracking
 */
async function downloadFile(url, dest, onProgress) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 30000
    });

    const totalLength = response.headers['content-length'];
    let downloadedLength = 0;

    const writer = fs.createWriteStream(dest);
    const data = response.data;

    return new Promise((resolve, reject) => {
        data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            if (onProgress && totalLength) onProgress((downloadedLength / totalLength) * 100);
        });

        data.pipe(writer);
        data.on('error', (err) => {
            writer.close();
            reject(err);
        });
        writer.on('finish', () => {
            writer.close();
            resolve();
        });
        writer.on('error', (err) => {
            writer.close();
            reject(err);
        });
    });
}

module.exports = {
    downloadFile
};
