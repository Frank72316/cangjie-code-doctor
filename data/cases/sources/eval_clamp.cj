func clamp(n: Int64): Int64 { if (n < 0) { 0 } else if (n > 100) { 100 } else { n } }
main() {
    println(clamp(-1))
    println(clamp(50))
    println(clamp(101))
}
