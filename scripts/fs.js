
import { promises as fs } from 'fs';
import path from 'path';

export const saveFile = async ({ fileName, pathName, data }) => {
  try {
    if (typeof fileName !== 'string' || !fileName || typeof pathName !== 'string' || !pathName) {
      console.error(`Error saving file ${pathName}/${fileName}: invalid fileName or pathName`);
      return null;
    }

    const text = typeof data === 'string' ? data : JSON.stringify(data);

    if (typeof text !== 'string') {
      console.error(`Error saving file ${pathName}/${fileName}: data could not be serialized`);
      return null;
    }

    const fullPath = path.join(process.cwd(), pathName, fileName);
    const dir = path.dirname(fullPath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, text, 'utf8');

    const sizeInMB = new TextEncoder().encode(text).length / (1024 * 1024);

    console.log(`Saved ${sizeInMB.toFixed(2)}MB to ${pathName}/${fileName}!`);
    return fullPath;
  } catch (err) {
    console.error(`Error saving file ${pathName}/${fileName}: ${err.message}`);
    return null;
  }
};
