import { Profile } from "core/details/profile";
import { YggdrasilUser } from "core/details/user";
import { validate } from "jsonschema";
import crypto from 'node:crypto';
import { getConfig } from "./config";

export function serializeProfile(profile: Profile, requiresProperties?: boolean, sigkey?: crypto.KeyLike) {
    let properties: any[] | undefined = undefined;
    if (requiresProperties) {
        let textures = {};
        if (profile.skin.length !== 0) {
            textures['SKIN'] = {
                url: `${getConfig().baseUrl}/textures/${profile.skin}`,
                metadata: {
                    model: profile.slim == 0 ? 'default' : 'slim'
                }
            };
        }
        if (profile.cape.length !== 0) {
            textures['CAPE'] = {
                url: `${getConfig().baseUrl}/textures/${profile.cape}`
            };
        }

        const textureProps = {
            timestamp: Date.now(),
            profileId: profile.id,
            profileName: profile.name,
            textures
        };

        properties = [
            {
                name: 'textures',
                value: Buffer.from(JSON.stringify(textureProps), 'utf-8').toString('base64'),
            },
            {
                name: 'uploadableTextures',
                value: 'skin,cape',
            }
        ];

        if (sigkey) {
            for (let v of properties) {
                v.signature = crypto.sign('RSA-SHA1', Buffer.from(v.value), sigkey).toString('base64');
            }
        }
    }

    return {
        id: profile.id,
        name: profile.name,
        properties
    };
}

export function serializeUser(user: YggdrasilUser, requireProperties?: boolean) {
    return {
        id: user.id,
        properties: requireProperties ? [
            {
                name: 'preferredLanguage',
                value: user.preferredLanguage
            }
        ] : undefined
    }
}

export const schemaCheck = {
    body(schema) {
        return function (req, res, next) {
            const valid = validate(req.body, schema);
            if (!valid.valid) {
                res.status(400).send({
                    error: valid.errors.join('\n')
                });
            }
            else {
                next();
            }
        }
    },
    query(schema) {
        return function (req, res, next) {
            const valid = validate(req.query, schema);
            if (!valid.valid) {
                res.status(400).send({
                    error: valid.errors.join('\n')
                });
            }
            else {
                next();
            }
        }
    }
};
