package doctor

func check(condition: Bool, name: String): Unit {
    if (!condition) { throw Exception("FAIL: " + name) }
}

func rejects(input: String): Bool {
    try { JsonReader(input).parse(); false } catch (_: Exception) { true }
}

// No compiler or candidate is launched by these deterministic contract checks.
func runSelfTests(): Int64 {
    try {
        check(CompileResult(0, "").status == "compile_passed", "clean cjc output")
        check(CompileResult(1, "").status == "tool_error", "empty failed compiler")
        check(CompileResult(-1073741819, "").status == "tool_error", "runtime crash")
        let raw = "{\"Diags\":[{\"Severity\":\"error\",\"Message\":\"wrong type\",\"Location\":{\"File\":\"input.cj\",\"Line\":2,\"Column\":24}}],\"Num\":{\"Errors\":1}}"
        let failed = CompileResult(1, raw)
        check(failed.status == "compile_failed" && failed.diagnostics.size == 1, "structured error")
        check(failed.diagnostics[0].line == 2 && failed.diagnostics[0].column == 24, "coordinates")
        check(CompileResult(0, raw).status == "tool_error", "contradictory exit code")
        check(CompileResult(-1073741819, raw).status == "tool_error", "crash with stale JSON")
        check(CompileResult(11, raw).status == "tool_error", "POSIX signal is not a compiler diagnostic exit")
        check(!validTaskId("../../other") && validTaskId("0123456789abcdef0123456789abcdef"), "task ID boundary")
        check(CompileResult(0, "{}").status == "tool_error", "missing compiler fields")
        check(CompileResult(1, "{\"Diags\":[],\"Num\":{\"Errors\":2}}").parseState == "partial", "missing diagnostics are partial")
        check(CompileResult(0, "{\"Diags\":[],\"Num\":{\"Errors\":999999999999999999999999}}").status == "tool_error", "overflow does not become zero")
        check(rejects("{\"x\":1,\"x\":2}"), "duplicate keys")
        check(rejects("[1,]"), "trailing comma")
        check(rejects("{ } x"), "trailing data")
        check(rejects("\"\\uD800\""), "unpaired surrogate")
        check(JsonReader("\"\\u4ed3\\u9889\\ud83d\\ude00\"").parse().text == "仓颉😀", "Unicode escapes")
        let text = "引号\"、斜杠\\、换行\n与制表\t"
        check(JsonReader(jsonString(text)).parse().text == text, "JSON string round trip")
        check(JsonReader(failed.toJson()).parse().field("testStatus").text == "not_run", "compile is not a behavior test")
        println("PASS: diagnostic contract self-tests")
        return 0
    } catch (e: Exception) { println(e.message); return 1 }
}
