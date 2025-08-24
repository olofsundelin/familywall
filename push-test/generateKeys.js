const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('Public key:', keys.publicKey);
console.log('Private key:', keys.privateKey);
