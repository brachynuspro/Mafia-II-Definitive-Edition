// xref-pe.mjs - encontra referencias cruzadas (RIP-relative) a um endereco no PE
// Procura LEA com RIP-relative (48 8D xx [offset32]) onde destino == alvo
// uso: node xref-pe.mjs <arquivo> <alvo-hex> [janela]
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const target = Number(process.argv[3]);  // 0x...
const buf = readFileSync(path);

console.log(`arquivo: ${path}`);
console.log(`alvo: 0x${target.toString(16)}`);
console.log('');

const regNames8 = ['rax','rcx','rdx','rbx','rsp','rbp','rsi','rdi'];
const regNames8ext = ['r8','r9','r10','r11','r12','r13','r14','r15'];

for (let i = 0; i < buf.length - 7; i++) {
  // 48 8D = REX.W + LEA r64, m
  if (buf[i] === 0x48 && buf[i+1] === 0x8D) {
    const modrm = buf[i+2];
    const mod = (modrm >> 6) & 3;
    const reg = (modrm >> 3) & 7;
    const rm = modrm & 7;
    if (mod === 0 && rm === 5) {  // RIP-relative
      const off = buf.readInt32LE(i+3);
      const dest = i + 7 + off;
      if (dest === target) {
        console.log(`  0x${i.toString(16)}: lea ${regNames8[reg]}, [rip+0x${off.toString(16)}] -> 0x${dest.toString(16)}`);
      }
    }
  }
  // 4C 8D = REX.WR + LEA r8..r15, m
  if (buf[i] === 0x4C && buf[i+1] === 0x8D) {
    const modrm = buf[i+2];
    const mod = (modrm >> 6) & 3;
    const reg = (modrm >> 3) & 7;
    const rm = modrm & 7;
    if (mod === 0 && rm === 5) {
      const off = buf.readInt32LE(i+3);
      const dest = i + 7 + off;
      if (dest === target) {
        console.log(`  0x${i.toString(16)}: lea ${regNames8ext[reg]}, [rip+0x${off.toString(16)}] -> 0x${dest.toString(16)}`);
      }
    }
  }
}
