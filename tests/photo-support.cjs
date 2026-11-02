// Offline functional fixtures. Attribution travels with the product samples.
const path = require('node:path');
const samples = {alpine: 'alpine-panorama.jpg', night: 'devils-tower.jpg', sunset: 'coastal-sunset.jpg'};
function testPhoto(name) {
  const file = samples[name.replace(/\.jpg$/, '')];
  if (!file) throw new Error('Unknown test photo: ' + name);
  return path.resolve(__dirname, '../风景调色协作平台/frontend/assets/welcome', file);
}
module.exports = {testPhoto};
