import { Database } from "./db";
import crypto from 'node:crypto';
import * as uuid from 'uuid';

enum SessionStatus {
    VALID,
    TEMPORARILY_INVALID,
    INVALID
};

interface Session {
    user: string;
    profile?: string;
    accessToken: string;
    clientToken: string;
    creation: number;
    status: SessionStatus;
};

class SessionDao {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    async findSession(accessToken: string): Promise<Session | null> {
        return await this.db.get('SELECT user,profile,accessToken,clientToken,creation,status FROM sessions ' +
            'WHERE accessToken = ?', [accessToken]) ?? null;
    }

    async selectProfile(accessToken: string, profile: string): Promise<boolean> {
        return (await this.db.run('UPDATE sessions SET profile = ? WHERE profile is NULL AND accessToken = ? AND status = ?',
            [profile, accessToken, SessionStatus.VALID])).changes !== 0;
    }

    async saveSession(session: Session): Promise<void> {
        return this.db.run('INSERT INTO sessions (user,profile,accessToken,clientToken,creation,status) ' +
            'VALUES (?,?,?,?,?,?)', [session.user, session.profile,
            session.accessToken, session.clientToken,
            session.creation, session.status]);
    }

    async invalidateSession(token: string): Promise<boolean> {
        return (await this.db.run('UPDATE sessions SET status = ? WHERE accessToken = ?', [SessionStatus.INVALID, token])).changes !== 0;
    }

    async invalidateUserSessions(user: string): Promise<boolean> {
        return (await this.db.run('UPDATE sessions SET status = ? WHERE user = ?', [SessionStatus.INVALID, user])).changes !== 0;
    }

    /*async invalidateSessionBefore(date: number): Promise<boolean> {
        return (await this.db.run('UPDATE sessions SET status = ? WHERE creation <= ?', [
            SessionStatus.INVALID, date])).changes !== 0;
    }*/

    async deleteSessionBefore(date: number): Promise<boolean> {
        return (await this.db.run('DELETE FROM sessions WHERE creation <= ?', [date])) !== 0;
    }

    async temporarilyInvalidateSessions(profile: string): Promise<boolean> {
        return (await this.db.run('UPDATE sessions SET status = ? WHERE profile = ? AND status = ?',
            [SessionStatus.TEMPORARILY_INVALID, profile, SessionStatus.VALID])).changes !== 0;
    }
};

export interface SMOptions {
    sessionExpiration: number;
};

export interface SessionInfo {
    accessToken: string;
    clientToken: string;
    user: string;
    profile?: string;
};

export class SessionManager {
    private db: Database;
    private dao: SessionDao;
    private options: SMOptions;

    constructor(db: Database, options: SMOptions) {
        this.db = db;
        this.dao = new SessionDao(db);
        this.options = options;
        setInterval(() => {
            this.dao.deleteSessionBefore(Date.now() - options.sessionExpiration);
        }, 30 * 1000);
    }

    async newSession(user: string, clientToken?: string): Promise<SessionInfo> {
        const accessToken = crypto.randomBytes(256).toString('hex');
        const clientTok = clientToken ?? uuid.v4().replace(/-/g, '');
        await this.dao.saveSession({
            user: user,
            accessToken,
            clientToken: clientTok,
            creation: Date.now(),
            status: SessionStatus.VALID
        });
        return {
            accessToken,
            clientToken: clientTok,
            user
        };
    }

    async selectProfile(token: string, profile: string) {
        await this.dao.selectProfile(token, profile);
    }

    async temporarilyInvalidateSessions(profile: string): Promise<void> {
        await this.dao.temporarilyInvalidateSessions(profile);
    }

    async invalidateSession(token: string): Promise<void> {
        await this.dao.invalidateSession(token);
    }

    async invalidateAllSessions(user: string): Promise<void> {
        await this.dao.invalidateUserSessions(user);
    }

    async findSessionByToken(token: string): Promise<SessionInfo | null> {
        const session = await this.dao.findSession(token);
        if (!session || session.status !== SessionStatus.VALID) {
            return null;
        }
        return {
            accessToken: session.accessToken,
            clientToken: session.clientToken,
            user: session.user,
            profile: session.profile
        };
    }

    async checkSession(accessToken: string, clientToken?: string, allowTemporarilyInvalid: boolean = false): Promise<boolean> {
        const session = await this.dao.findSession(accessToken);
        return session !== null && (session.status === SessionStatus.VALID || (allowTemporarilyInvalid && session.status === SessionStatus.TEMPORARILY_INVALID)) && (clientToken === undefined || session.clientToken === clientToken);
    }

    async refreshSession(accessToken: string, clientToken?: string, profile?: string): Promise<SessionInfo | null> {
        return this.db.transaction(async () => {
            const session = await this.dao.findSession(accessToken);
            if (!session) {
                return null;
            }
            if (clientToken && clientToken !== session?.clientToken) {
                return null;
            }
            const newSession = await this.newSession(session!!.user, session!!.clientToken);
            if (profile) {
                await this.selectProfile(newSession.accessToken, profile);
            }
            newSession.profile = profile;
            await this.invalidateSession(session!!.accessToken);
            return newSession;
        }) as unknown as SessionInfo;
    }
};

