package doctor

import std.collection.*

class Diagnostic {
    let code: String
    let severity: String
    let message: String
    let hint: String
    let file: String
    let line: Int64
    let column: Int64
    init(value: JsonValue) {
        code = value.field("DiagKind").stringValue()
        severity = value.field("Severity").stringValue()
        message = value.field("Message").stringValue()
        hint = value.field("MainHint").field("Content").stringValue()
        let location = value.field("Location")
        file = location.field("File").stringValue()
        line = location.field("Line").integerValue()
        column = location.field("Column").integerValue()
        if (line < 0 || column < 0) { throw Exception("Negative diagnostic coordinates") }
    }
    func toJson(): String {
        "{\"code\":" + jsonString(code) + ",\"severity\":" + jsonString(severity) +
        ",\"message\":" + jsonString(message) + ",\"hint\":" + jsonString(hint) +
        ",\"file\":" + jsonString(file) + ",\"line\":${line},\"column\":${column}}"
    }
}

class CompileResult {
    let exitCode: Int64
    let raw: String
    var status: String = "tool_error"
    var parseState: String = "invalid"
    var detail: String = ""
    let diagnostics = ArrayList<Diagnostic>()
    init(exitCode: Int64, raw: String) {
        this.exitCode = exitCode
        this.raw = raw
        try {
            // cjc 1.0.5 emits no JSON for a clean, successful compilation.
            if (raw.trimAscii().isEmpty()) {
                if (exitCode == 0) { status = "compile_passed"; parseState = "empty" }
                else { detail = "Compiler failed without structured diagnostics" }
                return
            }
            let root = JsonReader(raw).parse()
            let diags = root.field("Diags")
            let errors = root.field("Num").field("Errors")
            if (root.kind != "object" || diags.kind != "array" || errors.kind != "number") {
                throw Exception("Compiler JSON is missing Diags or Num.Errors")
            }
            var incomplete = false
            var visibleErrors: Int64 = 0
            for (item in diags.items) {
                let diagnostic = Diagnostic(item)
                if (diagnostic.severity == "error") { visibleErrors++ }
                if (item.kind != "object" || diagnostic.message.isEmpty() ||
                    (diagnostic.severity != "error" && diagnostic.severity != "warning" && diagnostic.severity != "note")) {
                    incomplete = true
                }
                diagnostics.add(diagnostic)
            }
            let errorCount = errors.integerValue()
            if (errorCount < visibleErrors || errorCount < 0) { throw Exception("Inconsistent error counts") }
            if (visibleErrors < errorCount) { incomplete = true }
            parseState = if (incomplete) { "partial" } else { "complete" }
            if (exitCode == 0 && errorCount == 0 && !incomplete) {
                status = "compile_passed"
            } else if (exitCode == 1 && errorCount > 0) {
                status = "compile_failed"
            } else {
                detail = "Compiler exit status and diagnostics do not confirm a normal compilation"
            }
        } catch (e: Exception) { detail = e.message }
    }
    func toJson(): String {
        var list = ""
        for (item in diagnostics) {
            if (!list.isEmpty()) { list += "," }
            list += item.toJson()
        }
        "{\"status\":" + jsonString(status) + ",\"exitCode\":${exitCode},\"parseState\":" +
        jsonString(parseState) + ",\"detail\":" + jsonString(detail) +
        ",\"testStatus\":\"not_run\",\"diagnostics\":[" + list + "],\"rawDiagnostics\":" + jsonString(raw) + "}"
    }
}
