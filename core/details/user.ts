import { Database } from "./db";
import bcrypt from 'bcrypt';
import * as uuid from 'uuid';

async function passwordHash(password: string): Promise<string> {
    return await bcrypt.hash(password, 10);
}

async function testPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
}

export interface YggdrasilUser {
    id: string;
    preferredLanguage: string;
};

interface User extends YggdrasilUser {
    email: string;
    passwordHash: string;
};


class UserDao {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    async findUserById(id: string): Promise<User | null> {
        return await this.db.get('SELECT id,email,passwordHash,preferredLanguage ' +
            'FROM users WHERE id = ?', [id]) ?? null;
    }

    async findUserByEmail(email: string): Promise<User | null> {
        return await this.db.get('SELECT id,email,passwordHash,preferredLanguage ' +
            'FROM users WHERE email = ?',
            [email]) ?? null;
    }

    async saveUser(user: User): Promise<boolean> {
        return (await this.db
            .run('INSERT OR IGNORE INTO users (id,email,passwordHash,preferredLanguage) ' +
                'VALUES (?,?,?,?)', [user.id, user.email, user.passwordHash, user.preferredLanguage])).changes !== 0;
    }

    async deleteUser(id: string): Promise<boolean> {
        return (await this.db
            .run('DELETE FROM users WHERE id = ? ', [id])).changes !== 0;
    }
};

export class UserManager {
    private db: Database;
    private dao: UserDao;

    constructor(db: Database) {
        this.db = db;
        this.dao = new UserDao(db);
    }

    async register(email: string, password: string, preferredLanguage: string = 'en_US'): Promise<string | null> {
        const id = uuid.v4().replace(/-/g, '');
        if (await this.dao.saveUser({ id, email, passwordHash: await passwordHash(password), preferredLanguage })) {
            return id;
        }
        return null;
    }

    async login(email: string, password: string): Promise<YggdrasilUser | null> {
        const user = await this.dao.findUserByEmail(email);
        if (!user) {
            return null;
        }
        if (await testPassword(password, user.passwordHash)) {
            return user;
        }
        return null;
    }

    async findUserById(id: string): Promise<YggdrasilUser | null> {
        return await this.dao.findUserById(id);
    }

    async findUserByEmail(email: string): Promise<YggdrasilUser | null> {
        return await this.dao.findUserByEmail(email);
    }

    async deleteUser(email: string): Promise<boolean> {
        const user = await this.dao.findUserByEmail(email);
        if (user) {
            await this.dao.deleteUser(user.id);
            return true;
        }
        return false;
    }
};
