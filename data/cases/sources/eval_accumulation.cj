func sumTo(n: Int64): Int64 {
 var total: Int64 = 0
 var i: Int64 = 1
 while (i < n) { total = total + i; i = i + 1 }
 total
}
main() {
    println(sumTo(0))
    println(sumTo(1))
    println(sumTo(4))
}
