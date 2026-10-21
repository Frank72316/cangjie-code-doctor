package doctor

import std.fs.*
import std.convert.*

main(args: Array<String>): Int64 {
    // Cangjie main receives user arguments without the executable name.
    if (args.size == 1 && args[0] == "--version") { println("Cangjie Code Doctor 0.1.0"); return 0 }
    if (args.size == 1 && args[0] == "--self-test") { return runSelfTests() }
    if (args.size != 3 || args[0] != "parse") {
        println("Usage: doctor parse <cjc-json-file> <compiler-exit-code>")
        println("Reads compiler evidence only; never compiles or runs imported source.")
        return 2
    }
    try {
        let raw = String.fromUtf8(File.readFrom(args[1]))
        let result = CompileResult(Int64.parse(args[2]), raw)
        println(result.toJson())
        if (result.status == "tool_error") { return 3 }
        return 0
    } catch (e: Exception) {
        println("{\"status\":\"tool_error\",\"detail\":" + jsonString(e.message) + "}")
        return 3
    }
}
