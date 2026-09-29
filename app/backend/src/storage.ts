import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root } from './config.js';

export interface StorageAdapter {
  newKey(extension:string):string;
  write(key:string):WriteStream;
  localPath(key:string):string;
  exists(key:string):boolean;
  remove(key:string):Promise<void>;
}
export class LocalStorageAdapter implements StorageAdapter {
  readonly directory=resolve(root,'uploads/media');
  constructor(){mkdirSync(this.directory,{recursive:true});}
  newKey(extension:string){if(!/^\.[a-z0-9]+$/.test(extension))throw new Error('Invalid extension');return randomUUID()+extension;}
  localPath(key:string){if(!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(key))throw new Error('Invalid media key');return resolve(this.directory,key);}
  write(key:string){return createWriteStream(this.localPath(key),{flags:'wx'});}
  exists(key:string){return existsSync(this.localPath(key));}
  remove(key:string){return rm(this.localPath(key),{force:true});}
}
// Object storage may implement the same contract in a future deployment.
const local=new LocalStorageAdapter();
export const storage:StorageAdapter=local;
export const mediaDirectory=local.directory;
