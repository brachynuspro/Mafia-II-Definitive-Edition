// Ghidra script: decompile specific functions and export as C
//@category Decompile
//@author kilo
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;

import java.io.FileWriter;
import java.io.PrintWriter;

public class DecompileTargets extends ghidra.app.script.GhidraScript {
    public void run() throws Exception {
        long[] targets = {
            0x3EFA40L, 0x3E9874L, 0x3E9A04L, 0x3F89B9L, 0x3F8A0BL, 0x3F8AE2L
        };

        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);

        PrintWriter out = new PrintWriter(new FileWriter(new java.io.File(System.getProperty("java.io.tmpdir"), "ghidra-decompiled.c")));

        FunctionManager fm = currentProgram.getFunctionManager();
        for (long addrLong : targets) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(addrLong);
            Function f = fm.getFunctionAt(addr);
            if (f == null) {
                out.println("/* No function at 0x" + Long.toHexString(addrLong) + " */");
                continue;
            }
            out.println("/* ============================================ */");
            out.println("/* FUNCTION: " + f.getName() + " @ 0x" + Long.toHexString(addrLong) + " */");
            out.println("/* ============================================ */");
            DecompileResults res = decomp.decompileFunction(f, 120, monitor);
            if (res.decompileCompleted()) {
                out.println(res.getDecompiledFunction().getC());
            } else {
                out.println("/* Decompile failed: " + res.getErrorMessage() + " */");
            }
            out.println();
        }
        out.close();
        println("Decompiled to " + new java.io.File(System.getProperty("java.io.tmpdir"), "ghidra-decompiled.c"));
    }
}
