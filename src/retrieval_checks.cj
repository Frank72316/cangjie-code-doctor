package doctor

// Synthetic documents below test the algorithm only. They are not evidence,
// official language guidance, or evaluation cases for repair effectiveness.
func syntheticRetrievalDocument(id: String, text: String): String {
    "{\"id\":" + jsonString(id) + ",\"title\":\"fixture\",\"url\":\"https://example.invalid/test\"," +
    "\"section\":\"test\",\"text\":" + jsonString(text) + "}"
}

func syntheticRetrievalCorpus(documents: String, version: String): String {
    "{\"schemaVersion\":1,\"sdkVersion\":" + jsonString(version) +
    ",\"snapshotId\":\"synthetic-self-test\",\"sourceRevision\":\"synthetic\",\"documents\":[" + documents + "]}"
}

func retrievalCorpusRejects(raw: String): Bool {
    try { RetrievalCorpus(raw); false } catch (_: Exception) { true }
}

func retrievalRequestRejects(corpus: RetrievalCorpus, raw: String): Bool {
    try { corpus.retrieve(raw); false } catch (_: Exception) { true }
}

func runRetrievalChecks(): Unit {
    let a = syntheticRetrievalDocument("a", "integer Int64 integer 类型转换")
    let b = syntheticRetrievalDocument("b", "String string 文本字符串")
    let c = syntheticRetrievalDocument("c", "integer integer integer integer extra padding padding padding padding padding padding padding")
    let corpus = RetrievalCorpus(syntheticRetrievalCorpus(a + "," + b + "," + c, "1.0.5"))
    let english = corpus.search("INT64", 3)
    check(english.size == 1 && english[0].document.id == "a" && english[0].score > 0.0, "retrieval ASCII case normalization")
    check(corpus.search("字符串", 3)[0].document.id == "b", "retrieval Chinese unigram/bigram matching")
    check(corpus.search("", 3).size == 0, "retrieval empty query")
    check(corpus.search("!! 😀", 3).size == 0, "retrieval punctuation query")
    check(corpus.search("absent_term_xyz", 3).size == 0, "retrieval out of vocabulary")
    let integer = corpus.search("integer", 3)
    check(integer.size == 2 && integer[0].score > integer[1].score, "retrieval BM25 produces ranked nonzero matches")
    check(corpus.search("integer integer", 3)[0].score == integer[0].score, "retrieval repeated query term deduplication")
    check(corpus.search("integer", 1).size == 1, "retrieval topK")
    let known = RetrievalCorpus(syntheticRetrievalCorpus(syntheticRetrievalDocument("a", "apple apple banana") + "," + syntheticRetrievalDocument("b", "banana pear pear"), "1.0.5"))
    let knownScore = known.search("apple", 3)[0].score
    // Equal document lengths, N=2, df=1, tf=2: ln(2) * 4.4 / 3.2.
    check(knownScore > 0.9530773732699 && knownScore < 0.9530773732700, "retrieval BM25 reference score")
    let commonScore = known.search("banana", 3)[0].score
    check(commonScore > 0.1823215567939 && commonScore < 0.1823215567940, "retrieval BM25 document frequency")
    let unequalLengths = RetrievalCorpus(syntheticRetrievalCorpus(syntheticRetrievalDocument("a", "apple apple banana") + "," + syntheticRetrievalDocument("b", "banana pear pear peach plum"), "1.0.5"))
    let normalizedScore = unequalLengths.search("apple", 3)[0].score
    check(normalizedScore > 0.9999500309717 && normalizedScore < 0.9999500309718, "retrieval BM25 document length normalization")
    let tied = RetrievalCorpus(syntheticRetrievalCorpus(syntheticRetrievalDocument("z", "same") + "," + syntheticRetrievalDocument("a", "same"), "1.0.5"))
    check(tied.search("same", 3)[0].document.id == "a", "retrieval lexical ID tie break")
    let query = "{\"sdkVersion\":\"1.0.5\",\"query\":\"integer 类型\",\"topK\":3}"
    check(corpus.retrieve(query) == corpus.retrieve(query), "retrieval deterministic serialized result")
    let chinese = RetrievalCorpus(syntheticRetrievalCorpus(syntheticRetrievalDocument("types", "类型 初始化 转换") + "," + syntheticRetrievalDocument("functions", "函数 参数 调用"), "1.0.5"))
    check(chinese.search("mismatched types", 3).size == 0 &&
        chinese.search(retrievalExpandedQuery("mismatched types"), 3)[0].document.id == "types", "retrieval English diagnostic to Chinese glossary")
    check(retrievalExpandedQuery("not found") == "not found\n标识符 作用域 声明", "retrieval fixed glossary phrase")
    check(retrievalExpandedQuery("参数") == "参数", "retrieval Chinese query preserved")
    check(retrievalCorpusRejects(syntheticRetrievalCorpus(a, "1.2.0")), "retrieval corpus version mismatch")
    check(retrievalCorpusRejects(syntheticRetrievalCorpus(a + "," + a, "1.0.5")), "retrieval duplicate document IDs")
    check(retrievalCorpusRejects(syntheticRetrievalCorpus("", "1.0.5")), "retrieval empty corpus invalid")
    check(retrievalCorpusRejects("{}"), "retrieval missing corpus schema")
    check(retrievalCorpusRejects(String.fromUtf8(Array<UInt8>(262145, repeat: 32))), "retrieval corpus size bound")
    check(retrievalCorpusRejects(syntheticRetrievalCorpus(syntheticRetrievalDocument("oversized", String.fromUtf8(Array<UInt8>(32769, repeat: 97))), "1.0.5")), "retrieval document size bound")
    check(retrievalRequestRejects(corpus, "{\"sdkVersion\":\"1.2.0\",\"query\":\"integer\",\"topK\":3}"), "retrieval query version mismatch")
    check(retrievalRequestRejects(corpus, "{\"sdkVersion\":\"1.0.5\",\"query\":\"integer\",\"topK\":0}"), "retrieval topK lower bound")
    check(retrievalRequestRejects(corpus, "{\"sdkVersion\":\"1.0.5\",\"query\":\"integer\",\"topK\":6}"), "retrieval topK upper bound")
    check(retrievalRequestRejects(corpus, "{\"sdkVersion\":\"1.0.5\",\"query\":null,\"topK\":3}"), "retrieval malformed query")
    check(retrievalRequestRejects(corpus, String.fromUtf8(Array<UInt8>(16385, repeat: 32))), "retrieval query size bound")
}
