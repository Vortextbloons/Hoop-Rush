import fs from 'node:fs';
const body = fs.readFileSync('.tmp-hdr.html', 'utf8');
const head = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0">
`;
fs.writeFileSync('.tmp-hdr-full.html', head + body + '\n</body>\n</html>\n');
console.log('written');
