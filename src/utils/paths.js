import path from 'node:path';

const currentDir = import.meta.dirname;
const currentFile = import.meta.filename;

export const publicFolder = path.join(currentDir, '../../public');