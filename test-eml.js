const emlFormat = require('eml-format');
const fs = require('fs');
const eml = fs.readFileSync('test.eml', 'utf-8');
emlFormat.read(eml, (err, data) => {
  if (err) return console.error(err);
  console.log("Keys:", Object.keys(data));
  console.log("Text length:", data.text ? data.text.length : 0);
});
