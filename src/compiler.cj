package doctor

import std.fs.*
import std.process.*

func smallText(path: String, limit: Int64): String {
    try (file = File(path, OpenMode.Read)) {
        if (file.length > limit) { throw Exception("File exceeds allowed size") }
        let buffer = Array<UInt8>(limit + 1, repeat: 0)
        var total: Int64 = 0
        while (total < buffer.size) {
            let n = file.read(buffer[total..buffer.size])
            if (n == 0) { break }
            total += n
        }
        if (total > limit) { throw Exception("File grew beyond allowed size") }
        return String.fromUtf8(buffer[0..total])
    }
    throw Exception("Unable to read file")
}

func runToFiles(command: String, arguments: Array<String>, directory: String, prefix: String): (Int64, String, String, Bool) {
    var code: Int64 = -1
    var timedOut = false
    try (out = File.create(directory + "/" + prefix + ".stdout"),
         err = File.create(directory + "/" + prefix + ".stderr")) {
        let child = launch(command, arguments, workingDirectory: Path(directory), stdIn: ProcessRedirect.Discard,
            stdOut: ProcessRedirect.FromFile(out), stdErr: ProcessRedirect.FromFile(err))
        try { code = child.wait(timeout: 30 * Duration.second) }
        catch (_: TimeoutException) {
            timedOut = true
            child.terminate(force: true)
            code = child.wait(timeout: 5 * Duration.second)
        }
    }
    let stdout = smallText(directory + "/" + prefix + ".stdout", 524288)
    let stderr = smallText(directory + "/" + prefix + ".stderr", 524288)
    (code, stdout, stderr, timedOut)
}

// The transport supplies a task ID and UTC timestamp, never a command or source.
// Only the compiler is launched; the generated program is never launched.
func compileExample(repo: String, compiler: String, name: String, taskId: String, capturedAt: String): String {
    if (!validTaskId(taskId)) { throw Exception("Invalid task ID") }
    if (capturedAt.size > 40 || capturedAt.isEmpty()) { throw Exception("Invalid capture timestamp") }
    let (expected, hash) = trustedExample(name)
    let root = canonicalize(repo).toString()
    let original = root + "/examples/" + name + ".cj"
    let source = smallText(original, 65536)
    if (source != expected) { throw Exception("Example changed since review; compilation refused") }
    let parent = root + "/runs/native"
    if (!exists(parent)) { Directory.create(parent, recursive: true) }
    let resolvedParent = canonicalize(parent).toString()
    if (!resolvedParent.startsWith(root + "/") && !resolvedParent.startsWith(root + "\\")) {
        throw Exception("Task storage must remain inside the repository")
    }
    let directory = resolvedParent + "/" + taskId
    Directory.create(directory) // Exclusive: an existing task is never overwritten.
    File.writeTo(directory + "/input.cj", source.toArray())
    let (versionCode, versionOut, versionErr, versionTimeout) = runToFiles(compiler, ["--version"], directory, "version")
    let version = (versionOut + versionErr).trimAscii()
    if (versionTimeout || versionCode != 0 || !version.startsWith("Cangjie Compiler: 1.0.5 (")) {
        throw Exception("The compiler must be SDK 1.0.5 and start normally")
    }
    let arguments = ["--diagnostic-format=json", "--error-count-limit", "8", "input.cj", "-o", "program.exe"]
    let (code, stdout, stderr, timedOut) = runToFiles(compiler, arguments, directory, "compiler")
    let raw = stderr + stdout
    let normalized = CompileResult(code, raw)
    let artifact = exists(directory + "/program.exe")
    if (timedOut || (!stdout.trimAscii().isEmpty() && !stderr.trimAscii().isEmpty()) ||
        (normalized.status == "compile_passed" && !artifact)) {
        normalized.status = "tool_error"
        normalized.detail = "Timeout, mixed output streams, or missing compilation artifact"
    }
    if (smallText(original, 65536) != source || smallText(directory + "/input.cj", 65536) != source) {
        throw Exception("Source changed during compilation; evidence not published")
    }
    let record = "{\"schemaVersion\":1,\"kind\":\"trusted-development-capture\",\"producer\":\"cangjie-core\",\"taskId\":" +
        jsonString(taskId) + ",\"capturedAt\":" + jsonString(capturedAt) +
        ",\"source\":{\"name\":" + jsonString(name + ".cj") + ",\"text\":" + jsonString(source) + ",\"sha256\":" + jsonString(hash) + "}," +
        "\"compiler\":{\"version\":" + jsonString(version) + ",\"inputName\":\"input.cj\",\"exitCode\":${code},\"stdout\":" +
        jsonString(stdout) + ",\"stderr\":" + jsonString(stderr) + ",\"timedOut\":${timedOut},\"artifactCreated\":${artifact}," +
        "\"arguments\":[\"--diagnostic-format=json\",\"--error-count-limit\",\"8\",\"input.cj\",\"-o\",\"program.exe\"]}," +
        "\"execution\":{\"attempted\":false,\"testStatus\":\"not_run\"},\"normalized\":" + normalized.toJson() + "}"
    File.writeTo(directory + "/record.pending.json", record.toArray())
    rename(directory + "/record.pending.json", to: directory + "/record.json")
    record
}
