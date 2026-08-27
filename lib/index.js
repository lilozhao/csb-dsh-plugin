import { createRequire as __dshCreateRequire } from 'node:module';
import { dirname as __dshDirname } from 'node:path';
import { fileURLToPath as __dshFileURLToPath } from 'node:url';
const require = __dshCreateRequire(import.meta.url);
const __filename = __dshFileURLToPath(import.meta.url);
const __dirname = __dshDirname(__filename);
var n="csb-host",t=["connection","webServer"];async function s(e,c={}){let o=typeof e.logger=="function"?e.logger("csb"):e.logger??console;return o.info?.("[csb] host plugin mounted (M1 skeleton)"),Object.freeze({name:n,async dispose(){o.info?.("[csb] host plugin disposed")}})}async function r(){return Object.freeze({name:n,inject:t,apply:s})}export{s as apply,r as createCsbHostPlugin,t as inject,n as name};
