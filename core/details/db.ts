export abstract class Database {
    abstract exec(sql: string): Promise<any>;
    abstract run(sql: string, params?: any): Promise<any>;
    abstract get(sql: string, params: any): Promise<any>;
    abstract all(sql: string, params: any): Promise<any[]>;

    private lock: Promise<unknown> | null;
    async transaction<T>(callback: () => T | Promise<T>): Promise<T | void> {
        if(this.lock) {
            await this.lock;
        }
        else {
            this.lock = (async () => {
                await this.exec('BEGIN');
                let result;
                try {
                    result = await callback();
                }
                catch(e) {
                    await this.exec('ROLLBACK');
                    throw e;
                }
                await this.exec('COMMIT');
                return result;
            })();
            let result = await this.lock as T;
            this.lock = null;
            return result;
        }
    }
};