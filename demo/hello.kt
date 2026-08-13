package demo

data class Greeting(val name: String, val message: String)

class Greeter(private val prefix: String = "Hello") {
    fun greet(name: String): Greeting {
        val message = "$prefix, $name!"
        return Greeting(name, message)
    }
}

fun main() {
    val greeter = Greeter()
    println(greeter.greet("Woo").message)
}
