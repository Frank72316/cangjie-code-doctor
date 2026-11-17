func isLeap(y: Int64): Bool { y % 4 == 0 }
main() {
    println(isLeap(2000))
    println(isLeap(1900))
    println(isLeap(2024))
    println(isLeap(2023))
}
