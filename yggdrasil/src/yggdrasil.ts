import express from 'express';
import { YggdrasilCore } from 'core';
import { Schema, validate } from 'jsonschema';
import { schemaCheck, serializeProfile, serializeUser } from './util';
import { getConfig } from './config';
import NodeCache from 'node-cache';
import multer from 'multer';
import sharp from 'sharp';

export class Yggdrasil {
    private app: express.Express;
    private access: YggdrasilCore;
    private servers: NodeCache;
    private rateLimit: NodeCache;

    constructor(core: YggdrasilCore) {
        this.app = express();
        this.access = core;
        this.servers = new NodeCache();
        this.rateLimit = new NodeCache();

        this.app.use(express.urlencoded({ extended: true }));
        this.app.use(express.json());

        this.app.get('/', async (req, res) => {
            res.send({
                meta: getConfig().meta,
                skinDomains: getConfig().skinDomains,
                signaturePublickey: getConfig().pubKey.export({ format: 'pem', type: 'spki' }).toString('utf-8')
            });
        });

        this.setupAuthServer();
        this.setupSessionServer();


        if (getConfig().baseUrl) {
            this.setupTexture();
        }

        this.app.get('/textures/:hash', async (req, res) => {
            res.type('image/png').send(await this.access.textureManager.findTextureByHash(req.params.hash));
        });


        this.app.use('/', (err, req, res, next) => {
            console.error(err);
            res.status(500).send();
        });
    }

    private setupAuthServer() {
        // Authenticate
        const authenticateSchema: Schema = {
            type: 'object',
            properties: {
                username: {
                    type: 'string',
                    format: 'email'
                },
                password: {
                    type: 'string',
                    maxLength: 48,
                    minLength: 8
                },
                clientToken: {
                    type: 'string'
                },
                requestUser: {
                    type: 'boolean'
                },
                agent: {
                    type: 'object',
                    enum: [{ name: 'Minecraft', version: 1 }]
                }
            },
            required: ['username', 'password']
        };
        this.app.post(
            '/authserver/authenticate', schemaCheck.body(authenticateSchema),
            async (req, res) => {
                let failures = this.rateLimit.get(req.body.username) as number ?? 0;
                if (failures >= 4) {
                    this.rateLimit.set(req.body.username, failures, 60);
                    res.status(403).send({
                        error: 'ForbiddenOperationException',
                        errorMessage: 'Invalid credentials. Invalid username or password.'
                    });
                    return;
                }
                const user = await this.access.userManager.login(req.body.username, req.body.password);
                if (!user) {
                    res.status(403).send({
                        error: 'ForbiddenOperationException',
                        errorMessage: 'Invalid credentials. Invalid username or password.'
                    });
                    this.rateLimit.set(req.body.username, failures + 1, 60);
                    return;
                }
                const session = await this.access.sessionManager.newSession(user.id, req.body.clientToken);
                const availableProfiles: any[] = [];
                let selectedProfile = undefined;

                try {
                    const profiles = await this.access.profileManager.getUserProfiles(user.id);
                    for (let v of profiles) {
                        availableProfiles.push(serializeProfile(v));
                    }


                    if (profiles.length === 1) {
                        selectedProfile = availableProfiles[0];
                        await this.access.sessionManager.selectProfile(session.accessToken, profiles[0].id);
                    }
                }
                catch (e) {
                    console.error(e);
                }


                const result = {
                    accessToken: session.accessToken,
                    clientToken: session.clientToken,
                    availableProfiles,
                    selectedProfile,
                    user: req.body.requestUser ? serializeUser(user, true) : undefined
                };
                res.send(result);
            }
        );


        // Refresh
        const refreshSchema: Schema = {
            type: 'object',
            properties: {
                accessToken: {
                    type: 'string',
                },
                clientToken: {
                    type: 'string'
                },
                requestUser: {
                    type: 'boolean'
                },
                selectedProfile: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'string'
                        },
                        name: {
                            type: 'string'
                        },
                        properties: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    name: {
                                        type: 'string'
                                    },
                                    value: {
                                        type: 'string'
                                    },
                                    signature: {
                                        type: 'string'
                                    }
                                },
                                required: ['name', 'value']
                            }
                        }
                    },
                    required: ['id', 'name']
                }
            },
            required: ['accessToken']
        }
        this.app.post('/authserver/refresh', schemaCheck.body(refreshSchema), async (req, res) => {
            const session = await this.access.sessionManager.findSessionByToken(req.body.accessToken);
            if (!session) {
                res.status(403).send({
                    error: 'ForbiddenOperationException',
                    errorMessage: 'Invalid token.'
                });
                return;
            }

            const requestedProfile = req.body.selectedProfile?.id;
            if (requestedProfile) {
                if (session.profile) {
                    res.status(400).send({
                        error: 'IllegalArgumentException',
                        errorMessage: ''
                    });
                    return;
                }
                const realProfile = await this.access.profileManager.findProfileById(requestedProfile);
                if (!realProfile) {
                    res.status(400).send({
                        error: 'IllegalArgumentException',
                        errorMessage: ''
                    });
                    return;
                }
                else if (realProfile.user !== session.user) {
                    res.status(403).send({
                        error: 'ForbiddenOperationException',
                        errorMessage: 'Invalid token.'
                    });
                    return;
                }
            }

            const refresh = await this.access.sessionManager.refreshSession(req.body.accessToken, req.body.clientToken, requestedProfile || session.profile);

            if (!refresh) {
                res.status(403).send({
                    error: 'ForbiddenOperationException',
                    errorMessage: 'Invalid token.'
                });
                return;
            }

            let user: any = undefined;

            if (req.body.requestUser) {
                user = serializeUser((await this.access.userManager.findUserById(refresh.user))!!, true);
            }

            let selectedProfile: any = undefined;
            if (refresh.profile) {
                const profile = await this.access.profileManager.findProfileById(refresh.profile);
                selectedProfile = serializeProfile(profile!!);
            }

            res.send({
                accessToken: refresh.accessToken,
                clientToken: refresh.clientToken,
                selectedProfile,
                user
            });
        });


        // Validate
        const validateSchema: Schema = {
            type: 'object',
            properties: {
                accessToken: {
                    type: 'string'
                },
                clientToken: {
                    type: 'string'
                }
            },
            required: ['accessToken']
        };
        this.app.post('/authserver/validate', schemaCheck.body(validateSchema), async (req, res) => {
            const check = await this.access.sessionManager.checkSession(req.body.accessToken, req.body.clientToken);
            if (check) {
                res.status(204).send();
            }
            else {
                res.status(403).send({
                    error: 'ForbiddenOperationException',
                    errorMessage: 'Invalid token.'
                });
            }
        });

        // Invalidate
        const invalidateSchema: Schema = {
            type: 'object',
            properties: {
                accessToken: {
                    type: 'string'
                },
                clientToken: {
                    type: 'string'
                }
            },
            required: ['accessToken']
        };
        this.app.post('/authserver/invalidate', schemaCheck.body(invalidateSchema), async (req, res) => {

            this.access.sessionManager.invalidateSession(req.body.accessToken);
            res.status(204).send();
        })


        // Sign out        

        const signoutSchema: Schema = {
            type: 'object',
            properties: {
                username: {
                    type: 'string',
                    format: 'email'
                },
                password: {
                    type: 'string',
                    maxLength: 48,
                    minLength: 8
                }
            },
            required: ['username', 'password']
        };
        this.app.post('/authserver/signout', schemaCheck.body(signoutSchema), async (req, res) => {
            let failures = this.rateLimit.get(req.body.username) as number ?? 0;
            if (failures >= 4) {
                this.rateLimit.set(req.body.username, failures, 60);
                res.status(403).send({
                    error: 'ForbiddenOperationException',
                    errorMessage: 'Invalid credentials. Invalid username or password.'
                });
                return;
            }
            const user = await this.access.userManager.login(req.body.username, req.body.password);
            if (!user) {
                res.status(403).send({
                    error: 'ForbiddenOperationException',
                    errorMessage: 'Invalid credentials. Invalid username or password.'
                });
                this.rateLimit.set(req.body.username, failures + 1, 60);
                return;
            }

            this.access.sessionManager.invalidateAllSessions(user.id);
            res.status(204).send();
        });
    }

    private setupSessionServer() {
        // Join
        const joinSchema: Schema = {
            type: 'object',
            properties: {
                accessToken: {
                    type: 'string'
                },
                selectedProfile: {
                    type: 'string'
                },
                serverId: {
                    type: 'string'
                }
            },
            required: ['accessToken', 'selectedProfile', 'serverId']
        };
        this.app.post('/sessionserver/session/minecraft/join', schemaCheck.body(joinSchema),
            async (req, res) => {

                const session = await this.access.sessionManager.findSessionByToken(req.body.accessToken);

                if (session?.profile === req.body.selectedProfile) {
                    this.servers.set(session!!.profile!!, req.body.serverId, 30000);
                    res.status(204).send();
                }
                else {
                    res.status(403).send({
                        error: 'ForbiddenOperationException',
                        errorMessage: 'Invalid token.'
                    });
                    return;
                }
            }
        );

        // Has Joined
        const hjoinedSchema: Schema = {
            type: 'object',
            properties: {
                username: {
                    type: 'string'
                },
                serverId: {
                    type: 'string'
                },
                ip: {
                    type: 'string'
                }
            },
            required: ['username', 'serverId']
        };
        this.app.get('/sessionserver/session/minecraft/hasJoined', schemaCheck.query(hjoinedSchema),
            async (req, res) => {
                const profile = await this.access.profileManager.findProfileByName(req.query.username as string);
                if (profile !== null && this.servers.get(profile.id) === req.query.serverId as string && (!req.query.ip || req.query.ip as string === req.ip?.toString())) {
                    res.send(serializeProfile(profile, true, getConfig().signKey));
                }
                else {
                    res.status(204).send();
                }
            });

        // Get profile
        this.app.get('/sessionserver/session/minecraft/profile/:uuid', async (req, res) => {
            const profile = await this.access.profileManager.findProfileById(req.params.uuid);
            if (!profile) {
                res.status(204).send();
                return;
            }
            const unsigned = req.query['unsigned'] !== 'false';
            res.send(serializeProfile(profile!!, true, unsigned ? undefined : getConfig().signKey));
        });


        // session server?
        // Get profiles
        const gprofilesSchema: Schema = {
            type: 'array',
            items: {
                type: 'string'
            }
        };
        this.app.post('/api/profiles/minecraft', schemaCheck.body(gprofilesSchema),
            async (req, res) => {
                const players: string[] = req.body;
                if (players.length > 8) {
                    res.status(403).send({
                        error: 'Forbidden',
                        errorMessage: 'The players requested are too many.'
                    });
                    return;
                }

                const uniquePlayers = new Set(players);
                let result: any[] = [];
                //let valid = false;
                for (let player of uniquePlayers.values()) {
                    const profile = await this.access.profileManager.findProfileByName(player);
                    if (profile) {
                        result.push(serializeProfile(profile));
                        //valid = true;
                    }
                    else {
                        //result.push({ id: "0000000000000000", name: "" });
                    }
                }
                /*if (result.length === 1 && !valid) {
                    result = [];
                }*/
                res.send(result);
            }
        );
    }

    private setupTexture() {
        const imageUploader = multer({
            storage: multer.memoryStorage(),
            fileFilter: (req, file, cb) => {
                if (file.mimetype === 'image/png') {
                    cb(null, true);
                }
                else {
                    cb(null, false);
                }
            }
        });


        this.app.put('/api/user/profile/:uuid/:textureType', imageUploader.single('file'), async (req, res) => {
            if (!['skin', 'cape'].includes(req.params.textureType)) {
                res.status(400).send();
                return;
            }

            const auth = req.headers.authorization;
            let authed = true;
            let accessToken;
            if (!auth) {
                authed = false;
            }
            else {
                const match = /^Bearer (\S+)/.exec(auth);
                if (!match) {
                    authed = false;
                }
                else {
                    accessToken = match[1];
                    const session = await this.access.sessionManager.findSessionByToken(accessToken);
                    if (session?.profile !== req.params.uuid) {
                        authed = false;
                    }
                }
            }

            if (!authed) {
                res.status(401).send({
                    error: 'ForbiddenOperationException',
                    errorMessage: 'Invalid token.'
                });
                return;
            }
            else if (!req.file || req.file.size > 8192 || !['cape', 'skin'].includes(req.params.textureType)) {
                res.status(400).send();
                return;
            }

            let model = req.body.model;
            if (!['slim', ''].includes(model)) {
                res.status(400).send();
                return;
            }

            const { data, info } = await sharp(req.file.buffer).toBuffer({ resolveWithObject: true });
            if (req.body.payload.type === 'skin' && (info.width !== 64 || (info.height !== 64 && info.height !== 32))) {
                res.status(400).send();
                return;
            }
            else if (!(info.width === 22 && info.height === 17) && !(info.width === 64 && info.height === 32)) {
                res.status(400).send();
                return;
            }

            const hash = await this.access.textureManager.saveTexture(data);
            let success;
            if (req.params.textureType === 'skin') {
                // transaction?
                success = await this.access.profileManager.updateSkin(
                    req.params.uuid, hash,
                    model === 'slim');
            }
            else {
                success = await this.access.profileManager.updateCape(req.params.uuid, hash)
            }
            if (!success) {
                res.status(500);
            }
            else {
                res.status(204);
            }
            res.send();
        });

        this.app.delete('/api/user/profile/:uuid/:textureType', async (req, res) => {
            if (!['skin', 'cape'].includes(req.params.textureType)) {
                res.status(400).send();
                return;
            }

            const auth = req.headers.authorization;
            let authed = true;
            let accessToken;
            if (!auth) {
                authed = false;
            }
            else {
                const match = /^Bearer (\S+)/.exec(auth);
                if (!match) {
                    authed = false;
                }
                else {
                    accessToken = match[1];
                    const session = await this.access.sessionManager.findSessionByToken(accessToken);
                    if (session?.profile !== req.params.uuid) {
                        authed = false;
                    }
                }
            }

            if (!authed) {
                res.status(401).send({
                    error: 'ForbiddenOperationException',
                    errorMessage: 'Invalid token.'
                });
                return;
            }

            let success;
            if (req.params.textureType === 'skin') {
                success = await this.access.profileManager.updateSkin(req.params.uuid, '', false);
            }
            else {
                success = await this.access.profileManager.updateCape(req.params.uuid, '');
            }

            if (!success) {
                res.status(500);
            }
            res.send();
        });

    }

    listen(...args) {
        this.app.listen(...args);
    }
}
