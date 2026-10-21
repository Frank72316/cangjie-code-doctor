package doctor

import std.collection.*
import std.convert.*

// A bounded JSON reader for the compiler adapter; unknown fields remain available.
// It is deliberately independent of the optional stdx/HTTP integration.
class JsonValue {
    let kind: String
    var text: String = ""
    let fields = HashMap<String, JsonValue>()
    let items = ArrayList<JsonValue>()
    init(kind: String) { this.kind = kind }
    func field(key: String): JsonValue {
        fields.get(key) ?? JsonValue("null")
    }
    func stringValue(): String { if (kind == "string") { text } else { "" } }
    func integerValue(): Int64 {
        if (kind == "null") { return 0 }
        if (kind != "number") { throw Exception("Expected an integer") }
        Int64.parse(text)
    }
}

class JsonReader {
    let bytes: Array<UInt8>
    var at: Int64 = 0
    init(input: String) {
        if (input.size > 1048576) { throw Exception("JSON exceeds 1 MiB") }
        bytes = input.toArray()
    }
    func parse(): JsonValue {
        let value = readValue(0)
        whitespace()
        if (at != bytes.size) { throw Exception("Trailing JSON data") }
        value
    }
    func whitespace(): Unit {
        while (at < bytes.size && (bytes[at] == 32 || bytes[at] == 9 || bytes[at] == 10 || bytes[at] == 13)) { at++ }
    }
    func take(): UInt8 {
        if (at >= bytes.size) { throw Exception("Unexpected end of JSON") }
        let value = bytes[at]
        at++
        value
    }
    func expect(value: UInt8): Unit {
        if (take() != value) { throw Exception("Unexpected JSON token") }
    }
    func hex4(): UInt32 {
        var value: UInt32 = 0
        for (_ in 0..4) {
            let b = take()
            let digit: UInt32 = if (b >= 48 && b <= 57) { UInt32(b - 48) }
                else if (b >= 65 && b <= 70) { UInt32(b - 55) }
                else if (b >= 97 && b <= 102) { UInt32(b - 87) }
                else { throw Exception("Invalid Unicode escape") }
            value = value * 16 + digit
        }
        value
    }
    func readString(): String {
        expect(34)
        let result = ArrayList<UInt8>()
        while (true) {
            let b = take()
            if (b == 34) { return String.fromUtf8(result.toArray()) }
            if (b < 32) { throw Exception("Unescaped JSON control character") }
            if (b != 92) { result.add(b); continue }
            let escaped = take()
            match (escaped) {
                case 34 | 92 | 47 => result.add(escaped)
                case 98 => result.add(8)
                case 102 => result.add(12)
                case 110 => result.add(10)
                case 114 => result.add(13)
                case 116 => result.add(9)
                case 117 =>
                    var code = hex4()
                    if (code >= 0xD800 && code <= 0xDBFF) {
                        expect(92); expect(117)
                        let low = hex4()
                        if (low < 0xDC00 || low > 0xDFFF) { throw Exception("Invalid surrogate pair") }
                        code = 0x10000 + (code - 0xD800) * 1024 + low - 0xDC00
                    } else if (code >= 0xDC00 && code <= 0xDFFF) { throw Exception("Unpaired surrogate") }
                    result.add(all: Rune(code).toString().toArray())
                case _ => throw Exception("Invalid JSON escape")
            }
        }
        throw Exception("Unterminated JSON string")
    }
    func readValue(depth: Int64): JsonValue {
        if (depth > 64) { throw Exception("JSON nesting limit exceeded") }
        whitespace()
        if (at >= bytes.size) { throw Exception("Missing JSON value") }
        let b = bytes[at]
        if (b == 34) { let value = JsonValue("string"); value.text = readString(); return value }
        if (b == 123 || b == 91) {
            at++
            let object = b == 123
            let closing: UInt8 = if (object) { 125 } else { 93 }
            let value = JsonValue(if (object) { "object" } else { "array" })
            whitespace()
            if (at < bytes.size && bytes[at] == closing) { at++; return value }
            while (true) {
                whitespace()
                if (object) {
                    let key = readString()
                    if (value.fields.contains(key)) { throw Exception("Duplicate JSON key") }
                    whitespace(); expect(58)
                    value.fields.add(key, readValue(depth + 1))
                } else { value.items.add(readValue(depth + 1)) }
                whitespace()
                let next = take()
                if (next == closing) { return value }
                if (next != 44) { throw Exception("Missing JSON separator") }
            }
        }
        let start = at
        while (at < bytes.size && bytes[at] != 44 && bytes[at] != 93 && bytes[at] != 125 && bytes[at] > 32) { at++ }
        let token = String.fromUtf8(bytes[start..at])
        if (token == "null" || token == "true" || token == "false") {
            let value = JsonValue(if (token == "null") { "null" } else { "bool" })
            value.text = token
            return value
        }
        // Compiler coordinates and counts are integers. Reject unsupported scalars.
        if (token.isEmpty()) { throw Exception("Invalid JSON value") }
        var n: Int64 = 0
        if (token.startsWith("-")) { n = 1 }
        if (n == token.size) { throw Exception("Invalid JSON number") }
        let digits = token.toArray()
        if (digits[n] == 48 && n + 1 < digits.size) { throw Exception("Leading zero") }
        for (i in n..digits.size) {
            if (digits[i] < 48 || digits[i] > 57) { throw Exception("Unsupported JSON scalar") }
        }
        let value = JsonValue("number"); value.text = token
        value
    }
}

func jsonString(input: String): String {
    var result = "\""
    let hex = "0123456789abcdef".toArray()
    for (r in input.runes()) {
        match (r) {
            case r'"' => result += "\\\""
            case r'\\' => result += "\\\\"
            case r'\n' => result += "\\n"
            case r'\r' => result += "\\r"
            case r'\t' => result += "\\t"
            case _ =>
                let code = UInt32(r)
                if (code < 32) {
                    result += "\\u00" + String.fromUtf8([hex[Int64(code / 16)], hex[Int64(code % 16)]])
                } else { result += r.toString() }
        }
    }
    result + "\""
}
