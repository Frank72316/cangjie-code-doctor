package doctor

import std.fs.*
import std.convert.*

main(args: Array<String>): Int64 {
    // Cangjie main receives user arguments without the executable name.
    if (args.size == 1 && args[0] == "--version") { println("Cangjie Code Doctor 0.3.0"); return 0 }
    if (args.size == 1 && args[0] == "--self-test") { return runSelfTests() }
    if (args.size > 0 && args[0] == "check-output") {
        try {
            if (args.size != 4) {
                throw Exception("Usage: doctor check-output <actual-stdout-file> <expected-stdout-file> <program-exit-code>")
            }
            println(checkPublicOutput(args[1], args[2], Int64.parse(args[3])))
            return 0
        } catch (e: Exception) {
            println("{\"status\":\"tool_error\",\"detail\":" + jsonString(e.message) + "}")
            return 3
        }
    }
    if (args.size == 3 && args[0] == "retrieve") {
        try { println(retrieveDocuments(args[1], args[2])); return 0 }
        catch (e: Exception) { println("{\"status\":\"tool_error\",\"detail\":" + jsonString(e.message) + "}"); return 3 }
    }
    if (args.size == 6 && args[0] == "compile-example") {
        try { println(compileExample(args[1], args[2], args[3], args[4], args[5])); return 0 }
        catch (e: Exception) { println("{\"status\":\"tool_error\",\"detail\":" + jsonString(e.message) + "}"); return 3 }
    }
    if (args.size != 3 || args[0] != "parse") {
        println("Usage: doctor parse <cjc-json-file> <compiler-exit-code>")
        println("       doctor compile-example <repo> <cjc> <example-id> <task-id> <utc-time>")
        println("       doctor retrieve <corpus-file> <query-file>")
        println("       doctor check-output <actual-stdout-file> <expected-stdout-file> <program-exit-code>")
        println("compile-example only compiles reviewed samples. check-output only compares captured public-test bytes.")
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
