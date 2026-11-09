import{readFile,writeFile}from'node:fs/promises';
const path=process.argv[2];let s=await readFile(path,'utf8');const a='y preguntar si desea conocer otro plan.';if(!s.includes(a))throw Error('missing_catalog_anchor');await writeFile(path,s.replace(a,'sin añadir preguntas ni invitaciones de seguimiento.'));
