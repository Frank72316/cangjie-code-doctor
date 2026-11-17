func sumValues(values: Array<Int64>): Int64 {
 var total: Int64 = 0
 for (value in values) { total = total + value }
 total
}
main() {
    println(sumValues([1, -2, 4]))
    println(sumValues([0]))
}
