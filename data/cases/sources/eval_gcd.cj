func gcd(a: Int64, b: Int64): Int64 {
 var x = a
 var y = b
 while (y != 0) { let r = x % y; x = y; y = r }
 x
}
main() {
    println(gcd(12, 18))
    println(gcd(7, 0))
}
