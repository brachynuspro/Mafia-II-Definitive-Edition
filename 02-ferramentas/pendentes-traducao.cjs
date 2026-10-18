const fs=require('fs');const L=fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/).slice(1).filter(Boolean);
const feitos=new Set();const dir=process.argv[3];for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.tsv')))for(const l of fs.readFileSync(dir+'/'+f,'utf8').split(/\r?\n/).slice(1)){const en=l.split('\t')[0];if(en)feitos.add(en.trim().toLowerCase());}
const u=new Map();for(const l of L){const p=l.split(';');if(!p[0].includes('_Dabing_Generic_'))continue;const t=p.slice(2,p.length-1).join(';').replace(/^"|"$/g,'').trim();if(!t||feitos.has(t.toLowerCase()))continue;if(!u.has(t))u.set(t,+p[1]);}
console.log('pendentes',u.size);let i=0;for(const[t,d] of u){console.log(`${d.toFixed(1)}|${t}`);if(++i>=+process.argv[4])break;}
