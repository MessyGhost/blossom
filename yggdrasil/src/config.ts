import * as jsonSchema from 'jsonschema';
import fs from 'fs';
import { program } from 'commander';
import crypto from 'node:crypto';

program.requiredOption('-c, --config <file>');
program.parse();
const opts = program.opts();

export interface Config {
    database: string;
    signKey: crypto.KeyObject;
    pubKey: crypto.KeyObject;
    baseUrl?: string;
    listen: string | number;
    listenApi?: string | number;
    meta: object;
    skinDomains: string[];
};

interface ConfigFile {
    database: string;
    signKey: string;
    listen: string | number;
    listenApi?: string | number;
    baseUrl: string;
    meta: object;
    skinDomains?: string[];
};

let config: Config | null = null;

export function getConfig(): Config {
    if (config !== null) {
        return config;
    }
    let configFile: ConfigFile = JSON.parse(fs.readFileSync(opts['config'], 'utf-8').toString());
    const schema: jsonSchema.Schema = {
        type: 'object',
        properties: {
            database: {
                type: 'string'
            },
            signKey: {
                type: 'string'
            },
            baseUrl: {
                type: 'string',
                format: 'uri'
            },
            listen: {
                type: ['string', 'number']
            },
            listenApi: {
                type: ['string', 'number']
            },
            meta: {
                type: 'object'
            },
            skinDomains: {
                type: 'array',
                items: {
                    type: 'string',
                    format: 'domain'
                }
            }
        },
        required: ['database', 'signKey', 'listen', 'meta']
    };
    const validate = jsonSchema.validate(configFile!!, schema)
    if (!validate.valid) {
        throw new Error(`Invalid config: ${validate.errors.join('\n')}`);
    }

    const signKey = crypto.createPrivateKey(fs.readFileSync(configFile.signKey));
    const pubKey = crypto.createPublicKey(signKey);
    config = {
        database: configFile.database,
        signKey,
        pubKey,
        baseUrl: configFile.baseUrl,
        listen: configFile.listen,
        listenApi: configFile.listenApi,
        meta: configFile.meta,
        skinDomains: configFile.skinDomains ?? []
    };
    return config!!;
}
