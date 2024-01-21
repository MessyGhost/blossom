import { Database } from "./db";

export async function SqlTableManager(db: Database) {
        await db.exec('PRAGMA foreign_keys = ON');
        await db.exec('CREATE TABLE IF NOT EXISTS users (' +
                'id CHAR(32) PRIMARY KEY NOT NULL,' +
                'email VARCHAR(128) UNIQUE NOT NULL,' +
                'passwordHash CHAR(60) NOT NULL,' +
                'preferredLanguage VARCHAR(16) NOT NULL)')
        await db.exec('CREATE TABLE IF NOT EXISTS profiles (' +
                'id CHAR(32) PRIMARY KEY NOT NULL,' +
                'name VARCHAR(32) UNIQUE NOT NULL,' +
                'user CHAR(32) NOT NULL,' +
                'skin CHAR(64),' +
                'cape CHAR(64),' +
                'slim INTEGER DEFAULT 0,' +
                'FOREIGN KEY(user) REFERENCES users(id) ON DELETE CASCADE)')
        await db.exec('CREATE TABLE IF NOT EXISTS sessions (' +
                'user CHAR(32) NOT NULL,' +
                'profile CHAR(32),' +
                'accessToken TEXT PRIMARY KEY NOT NULL,' +
                'clientToken TEXT NOT NULL,' +
                'creation INTEGER NOT NULL,' +
                'status INTEGER NOT NULL,' +
                'FOREIGN KEY(user) REFERENCES users(id) ON DELETE CASCADE,' +
                'FOREIGN KEY(profile) REFERENCES profiles(id) ON DELETE CASCADE)');
        await db.exec('CREATE TABLE IF NOT EXISTS textures (' +
                'hash CHAR(64) PRIMARY KEY NOT NULL,' +
                'data TEXT NOT NULL,' +
                'refers INT)');
}
