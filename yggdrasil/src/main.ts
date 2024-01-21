import yggdrasil from "core";
import { Yggdrasil } from "./yggdrasil";
import { getConfig } from "./config";
import { ApiListener } from "./api";

process.on('unhandledRejection', (event: PromiseRejectionEvent) => {
    console.error(event);
});

const core = yggdrasil({
    database: getConfig().database
});


new Yggdrasil(core).listen(getConfig().listen);
const listenApi = getConfig().listenApi;
if(listenApi) {
    new Promise<void>((resolve, reject) => {
        try {
            new ApiListener(core).listen(getConfig().listenApi);
            resolve();
        }
        catch(err) {
            reject(err);
        }
    });
}
