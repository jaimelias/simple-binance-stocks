
import { promises as fs } from 'fs';
import path from 'path';

export const loadFile = async ({ fileName, pathName, log = true }) => {
  try {
    if (typeof fileName !== 'string' || !fileName || typeof pathName !== 'string' || !pathName) {

      if(log)
      {
        console.error(`Error opening ${pathName}/${fileName}: invalid fileName or pathName.`);
      }

      return null;
    }

    const fullPath = path.join(process.cwd(), pathName, fileName);
    const data = await fs.readFile(fullPath, 'utf8');

    if(log) {
        console.log(`File ${pathName}/${fileName} loaded!`);
    }
    
    return data;
  } catch (err) {
    if(log) {
        console.error(`Error opening ${pathName}/${fileName}: ${err.message}`);
    }
    return null;
  }
};

export const getStringSizeInMB = str => {
  try {
    return new TextEncoder().encode(typeof str === 'string' ? str : String(str ?? '')).length / (1024 * 1024);
  } catch (err) {
    console.error(`Error calculating string size: ${err.message}`);
    return 0;
  }
};

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

    const sizeInMB = getStringSizeInMB(text);

    console.log(`Saved ${sizeInMB.toFixed(2)}MB to ${pathName}/${fileName}!`);
    return fullPath;
  } catch (err) {
    console.error(`Error saving file ${pathName}/${fileName}: ${err.message}`);
    return null;
  }
};
