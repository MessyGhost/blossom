import { Database } from "./db";
import * as uuid from 'uuid';

export interface Profile {
    id: string;
    name: string;
    user: string;
    skin: string;
    cape: string;
    slim: number;
};

class ProfileDao {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    async getUserProfiles(user: string): Promise<Profile[]> {
        return this.db.all('SELECT id,name,user,skin,cape,slim FROM profiles ' +
            'WHERE user = ?', [user]);
    }

    async findProfileById(id: string): Promise<Profile | null> {
        return await this.db.get('SELECT id,name,user,skin,cape,slim FROM profiles ' +
            'WHERE id = ?', [id]) ?? null;
    }

    async findProfileByName(name: string): Promise<Profile | null> {
        return await this.db.get('SELECT id,name,user,skin,cape,slim FROM profiles ' +
            'WHERE name = ?', [name]) ?? null;
    }

    async saveProfile(profile: Profile): Promise<boolean> {
        return (await this.db
            .run('INSERT OR IGNORE INTO profiles (id,name,user,skin,cape,slim) ' +
                'VALUES (?,?,?,?,?,?)', [profile.id, profile.name, profile.user, profile.skin, profile.cape, profile.slim])).changes !== 0;
    }

    async updateName(id: string, name: string): Promise<boolean> {
        return (await this.db
            .run('UPDATE profiles SET name = ? WHERE id = ?', [name, id])).changes !== 0;
    }

    async updateSkin(id: string, skin: string, slim: boolean): Promise<boolean> {
        return (await this.db
            .run('UPDATE profiles SET skin = ?, slim = ? WHERE id = ?',
                [skin, slim ? 1 : 0, id])).changes !== 0;
    }

    async updateCape(id: string, cape: string): Promise<boolean> {
        return (await this.db
            .run('UPDATE profiles SET cape = ? WHERE id = ?', [cape, id])).changes !== 0;
    }

    async deleteProfile(id: string): Promise<boolean> {
        return (await this.db
            .run('DELETE FROM profiles WHERE id = ?', [id])).changes !== 0;

    }
};

export class ProfileManager {
    private db: Database;
    private dao: ProfileDao;

    constructor(db: Database) {
        this.db = db;
        this.dao = new ProfileDao(db);
    }

    async createProfile(user: string, name: string, id?: string): Promise<string | null> {
        id = id ?? uuid.v4().replace(/-/g, '');
        const success = await this.dao.saveProfile({
            id,
            name: name,
            user: user,
            skin: '',
            cape: '',
            slim: 0
        });
        if (success) {
            return id;
        }
        else {
            return null;
        }
    }

    async findProfileByName(name: string): Promise<Profile | null> {
        return await this.dao.findProfileByName(name);
    }

    async findProfileById(id: string): Promise<Profile | null> {
        return await this.dao.findProfileById(id);
    }

    async getUserProfiles(user: string): Promise<Profile[]> {
        return this.dao.getUserProfiles(user);
    }

    async userHasProfile(user: string, profile: string): Promise<boolean> {
        const po = await this.dao.findProfileById(profile);
        if (po?.user === user) {
            return true;
        }
        return false;
    }

    async deleteProfile(profile: string): Promise<boolean> {
        return await this.dao.deleteProfile(profile);
    }

    async updateName(profile: string, name: string): Promise<boolean> {
        return await this.dao.updateName(profile, name);
    }

    async updateSkin(profile: string, skin: string, slim: boolean): Promise<boolean> {
        return await this.dao.updateSkin(profile, skin, slim);
    }

    async updateCape(profile: string, cape: string): Promise<boolean> {
        return await this.dao.updateCape(profile, cape);
    }
};
