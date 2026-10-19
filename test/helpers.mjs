import fs from 'node:fs';
export const fixture = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
export const synthetic = (n) => fixture('synthetic')[n];
