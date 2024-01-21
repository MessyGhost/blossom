import { YggdrasilCore } from 'core';
import express from 'express';
import expressSession from 'express-session';
import { Schema, validate } from 'jsonschema';
import Cache from 'node-cache';
import crypto from 'node:crypto';
import sharp, { OutputInfo } from 'sharp';
import { getConfig } from './config';
import { schemaCheck } from './util';

class MyStore extends expressSession.Store {
    private cache: Cache;

    constructor() {
        super();
        this.cache = new Cache();
    }

    get(sid: string, callback: (err: any, session?: expressSession.SessionData | null | undefined) => void): void {
        callback(undefined, this.cache.get(sid));
    }

    set(sid: string, session: expressSession.SessionData, callback?: ((err?: any) => void) | undefined): void {
        this.cache.set(sid, session, 5 * 60);
        callback && callback(undefined);
    }

    destroy(sid: string, callback?: ((err?: any) => void) | undefined): void {
        this.cache.del(sid);
        callback && callback(undefined);
    }

}

declare module 'express-session' {
    interface SessionData {
        user?: string;
    }
}


export class ApiListener {
    private api: express.Express;
    private access: YggdrasilCore;

    constructor(access: YggdrasilCore) {
        this.api = express();
        this.access = access;

        this.api.use(expressSession({
            secret: crypto.randomBytes(16).toString('utf-8'),
            store: new MyStore(),
            saveUninitialized: false,
            resave: false
        }));

        this.api.use(express.json());

        // Register

        const regiserSchema: Schema = {
            type: 'object',
            properties: {
                email: {
                    type: 'string',
                    format: 'email'
                },
                password: {
                    type: 'string',
                    minLength: 8,
                    maxLength: 48
                }
            },
            required: ['email', 'password']
        }
        this.api.post('/api/register', schemaCheck.body(regiserSchema), async (req, res) => {
            const user = await this.access.userManager.register(req.body.email, req.body.password, 'en_US');
            if (user) {
                req.session.user = user;
            }
            else {
                res.status(403);
            }
            res.send();
        });


        //Login
        const loginSchema: Schema = {
            type: 'object',
            properties: {
                email: {
                    type: 'string',
                    format: 'email'
                },
                password: {
                    type: 'string',
                    minLength: 8,
                    maxLength: 48
                }
            },
            required: ['email', 'password']
        }
        this.api.post('/api/login', schemaCheck.body(loginSchema), async (req, res) => {

            const user = await this.access.userManager.login(req.body.email, req.body.password);
            if (!user) {
                res.status(403).send();
                return;
            }
            req.session.user = user.id;
            res.send();
        });


        // Create profile
        const cprofileSchema: Schema = {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    pattern: '^[0-9a-zA-Z_]{1,32}$'
                }
            },
            required: ['name']
        };
        this.api.post('/api/profile/create', this.sessionCheck,
            schemaCheck.body(cprofileSchema), async (req, res) => {
                const id = await access.profileManager.createProfile(req.session.user!!, req.body.name);
                res.send(id);
            }
        );


        // Rename
        const renameSchema: Schema = {
            type: 'object',
            properties: {
                profile: {
                    type: 'string'
                },
                name: {
                    type: 'string',
                    pattern: '^[0-9a-zA-Z_]{1,32}$'
                }
            },
            required: ['profile', 'name']
        };
        this.api.post('/api/profile/rename', this.sessionCheck,
            schemaCheck.body(renameSchema), async (req, res) => {
                if (!await access.profileManager.userHasProfile(req.session.user!!, req.body.profile)) {
                    res.status(403).send();
                }
                else {
                    if (!await access.profileManager.updateName(req.body.profile, req.body.name)) {
                        res.status(403).send();
                    }
                }
                await access.sessionManager.temporarilyInvalidateSessions(req.body.profile);
                res.send();
            }
        );


        // Delete profile
        this.api.post('/api/profile/delete', this.sessionCheck, async (req, res) => {
            if (typeof (req.body.id) !== 'string') {
                res.status(400).send();
                return;
            }

            if (await access.profileManager.userHasProfile(req.session.user!!, req.body.id)) {
                if (!await access.profileManager.deleteProfile(req.body.id)) {
                    res.status(403).send();
                }
                else {
                    res.send();
                }
            }
            else {
                res.status(403).send();
            }
        });


        // List profile
        this.api.get('/api/profile/list', this.sessionCheck, async (req, res) => {
            const profiles = await access.profileManager.getUserProfiles(req.session.user!!);
            res.send(profiles);
        });


        // Upload skin
        const sUploadschema: Schema = {
            type: 'object',
            properties: {
                profile: {
                    type: 'string'
                },
                payload: {
                    type: 'object',
                    properties: {
                        type: {
                            enum: ['skin', 'cape']
                        },
                        data: {
                            type: 'string'
                        },
                        model: {
                            enum: ['slim', 'default']
                        }
                    },
                    required: ['type', 'data']
                }
            },
            required: ['profile', 'payload']
        }
        this.api.post('/api/profile/skin', this.sessionCheck,
            schemaCheck.body(sUploadschema), async (req, res) => {
                if (!await this.access.profileManager.userHasProfile(req.session.user!!, req.body.profile)) {
                    res.status(403).send();
                    return;
                }

                let dataUploaded: Buffer;
                try {
                    dataUploaded = Buffer.from(req.body.payload.data, 'base64');
                }
                catch (err) {
                    res.status(400).send();
                    return;
                }

                let hash = '';
                if (dataUploaded.length !== 0) {
                    let data: Buffer, info: OutputInfo;
                    try {
                        ({ data, info } = await sharp(dataUploaded).png().toBuffer({ resolveWithObject: true }));
                    }
                    catch (err) {
                        res.status(400).send();
                        return;
                    }

                    if (req.body.payload.type === 'skin' && (info.width !== 64 || (info.height !== 64 && info.height !== 32))) {
                        res.status(400).send();
                        return;
                    }
                    else if (req.body.payload.type === 'cape' && !(info.width === 22 && info.height === 17) && !(info.width === 64 && info.height === 32)) {
                        res.status(400).send();
                        return;
                    }
                    hash = await this.access.textureManager.saveTexture(data);
                }

                let success;
                if (req.body.payload.type === 'skin') {
                    // transaction?
                    success = await this.access.profileManager.updateSkin(
                        req.body.profile, hash,
                        req.body.payload.model === 'slim');
                }
                else {
                    success = await this.access.profileManager.updateCape(req.body.profile, hash);
                }
                if (!success) {
                    res.status(403);
                }
                res.send();
            }
        );
    }

    private sessionCheck(req, res, next) {
        if (!req.session?.user) {
            res.status(403).send();
        }
        else {
            next();
        }
    }

    listen(...args) {
        this.api.listen(...args);
    }
}

