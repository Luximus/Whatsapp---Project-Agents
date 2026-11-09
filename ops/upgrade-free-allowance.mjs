import {readFile,writeFile} from 'node:fs/promises';
const path=process.argv[2];
if(!path)throw Error('catalog_path_required');
let s=await readFile(path,'utf8');
for(const [before,after] of [
 ['  catalogVersion: z.string().optional(),','  freeAllowance: record.nullable().optional(),\n  catalogVersion: z.string().optional(),'],
 ['whatsapp:commercial:v3:','whatsapp:commercial:v4:'],
 ['aiUsagePricing: record.optional(), version:', 'aiUsagePricing: record.optional(), freeAllowance: record.nullable().optional(), version:'],
 ['    packageProgramActive: packageData.data.active,','    freeAllowance: packageData.data.freeAllowance,\n    packageProgramActive: packageData.data.active,']
]){if(!s.includes(before))throw Error('missing_anchor:'+before);s=s.replace(before,after);}
await writeFile(path,s);
