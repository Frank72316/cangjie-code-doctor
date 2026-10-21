package doctor

// Exact, individually reviewed inputs. A modified file cannot become executable
// merely by editing a JSON manifest. Arbitrary input remains disabled.
func trustedExample(name: String): (String, String) {
    match (name) {
        case "type_mismatch" => ("main() {\n    let count: Int64 = \"three\"\n    println(count)\n}\n",
            "59cb8d96def152e2c5e358ddeb7137426328b8b5652f36a6c8dc684ff2a53534")
        case "undefined_name" => ("main() {\n    println(total)\n}\n",
            "3a26df5460afd866ab9c6d13c60c13c596eda4a088036cc8c17a366aa703bddb")
        case "argument_count" => ("func add(a: Int64, b: Int64): Int64 {\n    a + b\n}\n\nmain() {\n    println(add(2))\n}\n",
            "5e6612766b92804ebb6313a2b5a5c58e10cecb23b2539856ee8e5c71130810f5")
        case "hello" => ("main() {\n    println(\"Hello, Cangjie Code Doctor!\")\n}\n",
            "65fb68627ad591876357224b12af8618e2c5af3997c0e8bbbf9e4322f6d79845")
        case _ => throw Exception("Only the four reviewed examples can be compiled")
    }
}

func validTaskId(value: String): Bool {
    if (value.size != 32) { return false }
    for (b in value.toArray()) {
        if (!((b >= 48 && b <= 57) || (b >= 97 && b <= 102))) { return false }
    }
    true
}
