package doctor

import std.collection.*
import std.convert.*
import std.math.*

// Offline lexical retrieval over one explicitly supplied, version-pinned snapshot.
// This module performs no network requests, compilation, candidate execution or writes.
func retrievalString(value: JsonValue, key: String, limit: Int64): String {
    let item = value.field(key)
    if (item.kind != "string" || item.text.trimAscii().isEmpty() || item.text.size > limit) {
        throw Exception("Invalid retrieval field: " + key)
    }
    item.text
}

func retrievalCjk(code: UInt32): Bool {
    (code >= 0x3400 && code <= 0x4DBF) || (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0xF900 && code <= 0xFAFF) || (code >= 0x20000 && code <= 0x3134F)
}

// ASCII identifiers are lowercased; contiguous Han characters yield both unigrams
// and adjacent bigrams. Punctuation/whitespace break bigrams. No synonym expansion.
func retrievalTokens(input: String): ArrayList<String> {
    let tokens = ArrayList<String>()
    var ascii = ""
    var previousHan = ""
    for (r in input.runes()) {
        let code = UInt32(r)
        let identifier = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
            (code >= 48 && code <= 57) || code == 95
        if (identifier) {
            previousHan = ""
            ascii += if (code >= 65 && code <= 90) { Rune(code + 32).toString() } else { r.toString() }
        } else {
            if (!ascii.isEmpty()) { tokens.add(ascii); ascii = "" }
            if (retrievalCjk(code)) {
                let han = r.toString()
                tokens.add(han)
                if (!previousHan.isEmpty()) { tokens.add(previousHan + han) }
                previousHan = han
            } else { previousHan = "" }
        }
    }
    if (!ascii.isEmpty()) { tokens.add(ascii) }
    tokens
}

func retrievalContainsAny(tokens: HashMap<String, Bool>, words: Array<String>): Bool {
    for (word in words) { if (tokens.contains(word)) { return true } }
    false
}

// compiler-glossary-v1 is a fixed, transparent language bridge for English cjc
// diagnostics and the official Chinese corpus. It is not learned from evaluation
// cases. Each matched group is appended once, in the order below; the original
// query is always preserved. The same tokenizer is used before and after expansion.
func retrievalExpandedQuery(query: String): String {
    let tokens = HashMap<String, Bool>()
    for (token in retrievalTokens(query)) { tokens[token] = true }
    var effective = query
    if (retrievalContainsAny(tokens, ["mismatched", "mismatch", "types", "type", "conversion", "cast"])) {
        effective += "\n类型 初始化 转换"
    }
    if (retrievalContainsAny(tokens, ["undefined", "undeclared", "notfound", "name", "identifier", "scope"]) ||
        (tokens.contains("not") && tokens.contains("found"))) { effective += "\n标识符 作用域 声明" }
    if (retrievalContainsAny(tokens, ["argument", "arguments", "parameter", "parameters", "function", "call"])) {
        effective += "\n函数 参数 调用"
    }
    if (retrievalContainsAny(tokens, ["int8", "int16", "int32", "int64", "intnative", "uint8", "uint16", "uint32", "uint64", "uintnative", "integer"])) {
        effective += "\n整数 类型"
    }
    if (tokens.contains("string")) { effective += "\n字符串" }
    effective
}

class RetrievalDocument {
    let id: String
    let title: String
    let url: String
    let section: String
    let text: String
    let length: Int64
    let frequencies = HashMap<String, Int64>()
    init(value: JsonValue) {
        if (value.kind != "object") { throw Exception("Retrieval document must be an object") }
        id = retrievalString(value, "id", 128)
        title = retrievalString(value, "title", 512)
        url = retrievalString(value, "url", 2048)
        section = retrievalString(value, "section", 512)
        text = retrievalString(value, "text", 32768)
        if (!url.startsWith("https://")) { throw Exception("Document source must be an HTTPS reference") }
        let tokens = retrievalTokens(title + "\n" + section + "\n" + text)
        length = tokens.size
        if (length == 0) { throw Exception("Document has no searchable tokens") }
        for (token in tokens) { frequencies[token] = (frequencies.get(token) ?? 0) + 1 }
    }
    func toJson(score: Float64): String {
        "{\"id\":" + jsonString(id) + ",\"title\":" + jsonString(title) +
        ",\"url\":" + jsonString(url) + ",\"section\":" + jsonString(section) +
        ",\"text\":" + jsonString(text) + ",\"score\":" + score.format(".17g") + "}"
    }
}

class RetrievalHit {
    let document: RetrievalDocument
    let score: Float64
    init(document: RetrievalDocument, score: Float64) { this.document = document; this.score = score }
}

class RetrievalCorpus {
    let sdkVersion: String
    let snapshotId: String
    let sourceRevision: String
    let documents = ArrayList<RetrievalDocument>()
    let averageLength: Float64
    init(raw: String) {
        if (raw.size > 262144) { throw Exception("Retrieval corpus exceeds 256 KiB") }
        let root = JsonReader(raw).parse()
        if (root.kind != "object" || root.field("schemaVersion").kind != "number" ||
            root.field("schemaVersion").integerValue() != 1) { throw Exception("Unsupported retrieval corpus schema") }
        sdkVersion = retrievalString(root, "sdkVersion", 32)
        if (sdkVersion != "1.0.5") { throw Exception("Retrieval corpus must match SDK 1.0.5") }
        snapshotId = retrievalString(root, "snapshotId", 128)
        sourceRevision = retrievalString(root, "sourceRevision", 128)
        let source = root.field("documents")
        if (source.kind != "array" || source.items.size < 1 || source.items.size > 512) {
            throw Exception("Retrieval corpus must contain 1 to 512 documents")
        }
        let ids = HashMap<String, Bool>()
        var total: Int64 = 0
        for (item in source.items) {
            let document = RetrievalDocument(item)
            if (ids.contains(document.id)) { throw Exception("Duplicate retrieval document ID") }
            ids[document.id] = true
            documents.add(document)
            total += document.length
        }
        averageLength = Float64(total) / Float64(documents.size)
    }
    func search(query: String, topK: Int64): ArrayList<RetrievalHit> {
        if (topK < 1 || topK > 5) { throw Exception("Retrieval topK must be between 1 and 5") }
        // First-occurrence order makes floating-point accumulation reproducible.
        // Repeated query terms count once; document term frequencies remain intact.
        let terms = ArrayList<String>()
        let seen = HashMap<String, Bool>()
        for (token in retrievalTokens(query)) {
            if (!seen.contains(token)) { terms.add(token); seen[token] = true }
        }
        let idfs = HashMap<String, Float64>()
        for (term in terms) {
            var containing: Int64 = 0
            for (document in documents) { if (document.frequencies.contains(term)) { containing++ } }
            idfs[term] = log(1.0 + (Float64(documents.size - containing) + 0.5) / (Float64(containing) + 0.5))
        }
        let hits = ArrayList<RetrievalHit>()
        for (document in documents) {
            var score: Float64 = 0.0
            for (term in terms) {
                let frequency = Float64(document.frequencies.get(term) ?? 0)
                if (frequency > 0.0) {
                    let normalizer = frequency + 1.2 * (1.0 - 0.75 + 0.75 * Float64(document.length) / averageLength)
                    score += (idfs.get(term) ?? 0.0) * frequency * (1.2 + 1.0) / normalizer
                }
            }
            if (score > 0.0) { hits.add(RetrievalHit(document, score)) }
        }
        // At most 512 bounded documents; insertion sort avoids an unstable tie order.
        for (i in 1..hits.size) {
            let current = hits[i]
            var at = i
            while (at > 0 && (current.score > hits[at - 1].score ||
                (current.score == hits[at - 1].score && current.document.id < hits[at - 1].document.id))) {
                hits[at] = hits[at - 1]
                at--
            }
            hits[at] = current
        }
        let selected = ArrayList<RetrievalHit>()
        for (i in 0..hits.size) { if (i < topK) { selected.add(hits[i]) } }
        selected
    }
    func retrieve(rawQuery: String): String {
        if (rawQuery.size > 16384) { throw Exception("Retrieval query exceeds 16 KiB") }
        let request = JsonReader(rawQuery).parse()
        if (request.kind != "object" || request.field("sdkVersion").kind != "string" ||
            request.field("sdkVersion").text != sdkVersion) { throw Exception("Retrieval query and corpus SDK versions differ") }
        if (request.field("query").kind != "string" || request.field("topK").kind != "number") {
            throw Exception("Retrieval query requires string query and integer topK")
        }
        let query = request.field("query").text
        let topK = request.field("topK").integerValue()
        let effectiveQuery = retrievalExpandedQuery(query)
        let hits = search(effectiveQuery, topK)
        var list = ""
        for (hit in hits) {
            if (!list.isEmpty()) { list += "," }
            list += hit.document.toJson(hit.score)
        }
        "{\"schemaVersion\":1,\"sdkVersion\":" + jsonString(sdkVersion) + ",\"snapshotId\":" +
        jsonString(snapshotId) + ",\"sourceRevision\":" + jsonString(sourceRevision) + ",\"query\":" +
        jsonString(query) + ",\"effectiveQuery\":" + jsonString(effectiveQuery) +
        ",\"queryExpansion\":\"compiler-glossary-v1\",\"algorithm\":\"bm25\",\"parameters\":{\"k1\":1.2,\"b\":0.75}," +
        "\"tokenizer\":\"ascii-lower-identifier+cjk-unigram-bigram-v1\",\"topK\":${topK},\"results\":[" + list + "]}"
    }
}

func retrieveDocuments(corpusFile: String, queryFile: String): String {
    let corpus = RetrievalCorpus(smallText(corpusFile, 262144))
    corpus.retrieve(smallText(queryFile, 16384))
}
