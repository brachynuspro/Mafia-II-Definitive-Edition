#@category Decompile
#@author kilo
"""Decompile specific functions and export as C pseudocode."""
import os
from ghidra.app.decompiler import DecompInterface
from ghidra.app.decompiler import DecompileResults
from ghidra.program.model.address import Address
from ghidra.program.model.listing import FunctionManager

targets = [
    0x3EFA40, 0x3E9874, 0x3E9A04, 0x3F89B9, 0x3F8A0B, 0x3F8AE2,
    0x18525B0,  # 'full.#text' (string, may not be a function)
]

import os, tempfile
out_path = os.path.join(tempfile.gettempdir(), "ghidra-decompiled.c")
decomp = DecompInterface()
decomp.openProgram(currentProgram)

with open(out_path, "w") as out:
    fm = currentProgram.getFunctionManager()
    for addrLong in targets:
        addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(addrLong)
        out.write("/* ============================================ */\n")
        out.write("/* TARGET: 0x%X */\n" % addrLong)
        out.write("/* ============================================ */\n")
        f = fm.getFunctionAt(addr)
        if f is None:
            # tentar ver se há uma função que CONTEEM esse endereço
            f = fm.getFunctionContaining(addr)
            if f:
                out.write("/* Function containing: %s @ 0x%X (offset 0x%X into func) */\n" % (f.getName(), f.getEntryPoint().getOffset(), addrLong - f.getEntryPoint().getOffset()))
        if f is None:
            out.write("/* No function at or containing this address */\n\n")
            continue
        out.write("/* Function: %s */\n" % f.getName())
        out.write("/* Entry: 0x%X */\n" % f.getEntryPoint().getOffset())
        out.write("/* Size: %d bytes */\n" % f.getBody().getNumAddresses())
        res = decomp.decompileFunction(f, 300, monitor)
        if res.decompileCompleted():
            out.write(res.getDecompiledFunction().getC())
        else:
            out.write("/* Decompile failed: %s */\n" % res.getErrorMessage())
        out.write("\n\n")

print("Decompiled to", out_path)
