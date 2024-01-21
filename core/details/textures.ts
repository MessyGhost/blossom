import { Database } from "./db";
import crypto from 'node:crypto';

export class TextureManager {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    async findTextureByHash(hash: String): Promise<Buffer | null> {
        const data = await this.db.get('SELECT data FROM textures WHERE hash = ?', [hash]);
        if(data) {
            return Buffer.from(data.data, 'base64');
        }
        return null;
    }

    async saveTexture(texture: Buffer): Promise<string> {
        const data = texture.toString('base64');
        const hash = crypto.createHash('sha256').update(texture).digest('hex');
        await this.db.run('INSERT OR IGNORE INTO textures (hash, data) VALUES (?,?)',
            [hash, data]);
        return hash;
    }
};