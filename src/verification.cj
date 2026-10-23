package doctor

import std.fs.*

// Compare captured public-test output in the native core. Never execute a
// candidate here; the isolated runner supplies its actual process exit code.
func boundedOutputBytes(path: String, limit: Int64): Array<UInt8> {
    try (file = File(path, OpenMode.Read)) {
        if (file.length > limit) { throw Exception("Output file exceeds allowed size") }
        let buffer = Array<UInt8>(limit + 1, repeat: 0)
        var total: Int64 = 0
        while (total < buffer.size) {
            let count = file.read(buffer[total..buffer.size])
            if (count == 0) { break }
            total += count
        }
        if (total > limit) { throw Exception("Output file grew beyond allowed size") }
        return buffer[0..total]
    }
    throw Exception("Unable to read output file")
}

func checkPublicOutput(actualPath: String, expectedPath: String, exitCode: Int64): String {
    let actual = boundedOutputBytes(actualPath, 65536)
    let expected = boundedOutputBytes(expectedPath, 16384)
    var matches = actual.size == expected.size
    if (matches) {
        for (index in 0..actual.size) {
            if (actual[index] != expected[index]) { matches = false; break }
        }
    }
    let status = if (exitCode != 0) { "runtime_error" }
        else if (matches) { "passed" } else { "failed" }
    return "{\"status\":" + jsonString(status) +
        ",\"comparison\":\"exact_bytes\",\"exitCode\":" + exitCode.toString() +
        ",\"stdoutMatches\":" + matches.toString() +
        ",\"actualBytes\":" + actual.size.toString() +
        ",\"expectedBytes\":" + expected.size.toString() + "}"
}
