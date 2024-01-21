import { Database } from 'sqlite3';
import { ProfileManager } from './details/profile';
import { SqlTableManager } from './details/tables';
import { UserManager } from './details/user';
import { SessionManager } from './details/session';
import { Database as AbstractDatabase } from './details/db';
import { TextureManager } from './details/textures';

export interface YggdrasilOptions {
    sessionExpiration?: number;
    database: string;
};

export interface YggdrasilCore {
    profileManager: ProfileManager;
    userManager: UserManager;
    sessionManager: SessionManager;
    textureManager: TextureManager;
};

class MyDatabase extends AbstractDatabase {
    private db: Database;
    private promisified: any;

    constructor(db: Database) {
        super();
        this.db = db;
        db.on('error', err => {
            console.error(err);
        });
    }

    async exec(sql: string): Promise<any> {
        const _this = this;
        return new Promise((resolve, reject) => {
            _this.db.exec(sql, function (err) {
                if(err) {
                    reject(err);
                }
                else {
                    resolve(this);
                }
            });
        });
    }

    async run(sql: string, params?: any): Promise<any> {
        const _this = this;
        return new Promise(function (resolve, reject) {
            _this.db.run(sql, params, function(err) {
                if(err) {
                    reject(err);
                }
                else {
                    resolve(this);
                }
            });
        });
    }

    async get(sql: string, params: any): Promise<any> {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if(err) {
                    reject(err);
                }
                else {
                    resolve(row);
                }
            });
        });
    }

    async all(sql: string, params: any): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if(err) {
                    reject(err);
                }
                else {
                    resolve(rows);
                }
            });
        });
    }

}

export default function yggdrasil(options: YggdrasilOptions): YggdrasilCore {
    const db = new MyDatabase(new Database(options.database));
    SqlTableManager(db);
    return {
        profileManager: new ProfileManager(db),
        userManager: new UserManager(db),
        sessionManager: new SessionManager(db, {sessionExpiration: options.sessionExpiration?? 15 * 24 * 60 * 60 * 1000}),
        textureManager: new TextureManager(db)
    };
}
