func signLabel(n: Int64): String { if (n) { "positive" } else { "other" } }
main() {
    println(signLabel(2))
    println(signLabel(0))
    println(signLabel(-1))
}
