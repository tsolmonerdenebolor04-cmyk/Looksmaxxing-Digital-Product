import { mkdir, copyFile, readdir } from 'node:fs/promises';
// Explicit allowlist: never publish server sources, tests, or environment files.
await mkdir(new URL('./public/', import.meta.url), { recursive: true });
for (const file of await readdir(new URL('./public/', import.meta.url))) {
 if (!['index.html', 'app.js'].includes(file)) throw new Error('Unexpected public build artifact');
}
for (const file of ['index.html', 'app.js']) {
 await copyFile(new URL(file, import.meta.url), new URL('public/'+file, import.meta.url));
}
